const https = require('https');

const CRASH_KEYWORDS = [
  'accident', 'crash', 'multi-vehicle', 'multi vehicle',
  'collision', 'rollover', 'fatal', 'injury', 'hit and run', 'struck'
];

const SKIP_KEYWORDS = ['stall', 'debris', 'construction', 'maintenance'];

function fetchRSS() {
  return new Promise((resolve, reject) => {
    https.get('https://traffic.houstontranstar.org/data/rss/incidents_rss.xml', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const match = block.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return match ? (match[1] || match[2] || '').trim() : '';
    };
    items.push({
      title: get('title'),
      desc: get('description'),
      pubDate: get('pubDate'),
      link: get('link'),
    });
  }
  return items;
}

function isCrash(title) {
  const lower = title.toLowerCase();
  if (SKIP_KEYWORDS.some(k => lower.includes(k))) return false;
  return CRASH_KEYWORDS.some(k => lower.includes(k));
}

// Parse "Verified at 10:26 PM" or "Reported at 10:26 PM" from description
// Returns minutes ago, or null if unparseable
function minutesAgo(desc) {
  const match = desc.match(/(?:Verified|Reported|Active)\s+at\s+(\d{1,2}):(\d{2})\s+(AM|PM)/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  const now = new Date();
  // Convert now to Houston time (CDT = UTC-5 Mar-Nov, CST = UTC-6 Nov-Mar)
  const housonOffset = -5; // CDT (summer)
  const nowHouston = new Date(now.getTime() + housonOffset * 60 * 60 * 1000);
  const nowHour = nowHouston.getUTCHours();
  const nowMin = nowHouston.getUTCMinutes();

  let diffMin = (nowHour * 60 + nowMin) - (hour * 60 + min);
  // Handle midnight rollover
  if (diffMin < -720) diffMin += 1440;
  if (diffMin > 720) diffMin -= 1440;
  return diffMin;
}

function isCleared(desc) {
  return desc.toLowerCase().includes('cleared');
}

// Only alert if incident is fresh (< ALERT_WINDOW_MIN minutes old) and not cleared
const ALERT_WINDOW_MIN = 5;

module.exports = async (req, res) => {
  // Vercel automatically sends CRON_SECRET as Bearer token for cron requests
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const testMode = req.query && req.query.test === '1';

  // Test mode: send a real SMS without needing a live crash in the feed
  if (testMode) {
    const partnerPhones = (process.env.PARTNER_PHONES || '')
      .split(',').map(p => p.trim()).filter(Boolean);
    if (!partnerPhones.length)
      return res.json({ error: 'No PARTNER_PHONES set. Add it in Vercel dashboard first.' });
    if (!process.env.TWILIO_ACCOUNT_SID)
      return res.status(500).json({ error: 'Twilio not configured' });
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    for (const phone of partnerPhones) {
      await twilio.messages.create({
        body: `CRASHHELPTX TEST\nCrash alert system is live. When a real crash hits Houston freeways, you'll get a text like this.\nFree legal case review: (346) 860-1929\nReply STOP to opt out`,
        from: process.env.TWILIO_FROM,
        to: phone,
      });
    }
    return res.json({ ok: true, test: true, sent_to: partnerPhones });
  }

  let xml;
  try {
    xml = await fetchRSS();
  } catch (err) {
    console.error('RSS fetch error:', err.message);
    return res.status(500).json({ error: 'RSS fetch failed' });
  }

  const items = parseItems(xml);
  const crashes = [];

  for (const item of items) {
    if (!isCrash(item.title)) continue;
    if (isCleared(item.desc)) continue;
    const age = minutesAgo(item.desc);
    if (age !== null && age > ALERT_WINDOW_MIN) continue;
    if (age !== null && age < 0) continue; // future timestamp = parse error
    crashes.push(item);
  }

  if (crashes.length === 0) {
    console.log('No new crashes found in feed');
    return res.json({ sent: 0, checked: items.length, crashes: [] });
  }

  const partnerPhones = (process.env.PARTNER_PHONES || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  if (partnerPhones.length === 0) {
    console.log('No PARTNER_PHONES configured — crashes found but nobody to alert:', crashes.map(c => c.title));
    return res.json({ sent: 0, crashes: crashes.map(c => c.title), warning: 'No PARTNER_PHONES set' });
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM) {
    return res.status(500).json({ error: 'Twilio env vars not configured' });
  }

  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  let sent = 0;
  const errors = [];

  for (const crash of crashes) {
    const body =
      `CRASHHELPTX ALERT\n` +
      `${crash.title}\n` +
      `If you respond to this scene, hand the driver our card.\n` +
      `Free legal case review: (346) 860-1929\n` +
      `Reply STOP to opt out`;

    for (const phone of partnerPhones) {
      try {
        await twilio.messages.create({
          body,
          from: process.env.TWILIO_FROM,
          to: phone,
        });
        sent++;
        console.log(`Alerted ${phone}: ${crash.title}`);
      } catch (err) {
        console.error(`Twilio error to ${phone}:`, err.message);
        errors.push({ phone, error: err.message });
      }
    }
  }

  return res.json({
    sent,
    crashes: crashes.map(c => c.title),
    errors: errors.length ? errors : undefined,
  });
};
