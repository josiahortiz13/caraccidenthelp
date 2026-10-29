// Texas law library for the accident report feature. This is the ONLY source of legal citations the
// feature can show: the model picks ids from this list (enforced by the output schema), it never writes
// a citation itself. Every entry was checked against the official text on tcss.legis.texas.gov
// (statutes.capitol.texas.gov) on VERIFIED_ON. Summaries are plain-English paraphrases, not quotes.
// audience: 'public' entries may be shown to visitors as general information; 'attorney' entries only
// appear on the logged-in attorney review screen.
const VERIFIED_ON = '2026-10-29';

const url = (code, chapter, section) => `https://statutes.capitol.texas.gov/Docs/${code}/htm/${code}.${chapter}.htm#${section}`;

const LAWS = [
  // ---- Rules of the road (Transportation Code) ----
  { id: 'TN-544.004', cite: 'Tex. Transp. Code § 544.004', title: 'Compliance with traffic-control device', url: url('TN', 544, '544.004'), audience: 'public', topics: ['signs', 'signals'],
    summary: 'Drivers must obey official traffic-control devices (signs, signals, markings) unless directed otherwise by an officer.' },
  { id: 'TN-544.007', cite: 'Tex. Transp. Code § 544.007', title: 'Traffic-control signals in general', url: url('TN', 544, '544.007'), audience: 'public', topics: ['signals', 'red_light'],
    summary: 'Explains what green, yellow and red lights require. A driver facing a steady red must stop; a driver on a green must still yield to vehicles and pedestrians lawfully in the intersection.' },
  { id: 'TN-545.051', cite: 'Tex. Transp. Code § 545.051', title: 'Driving on right side of roadway', url: url('TN', 545, '545.051'), audience: 'public', topics: ['lane', 'head_on'],
    summary: 'Drivers must keep to the right half of a roadway, with listed exceptions such as passing or avoiding an obstruction.' },
  { id: 'TN-545.062', cite: 'Tex. Transp. Code § 545.062', title: 'Following distance', url: url('TN', 545, '545.062'), audience: 'public', topics: ['rear_end'],
    summary: 'A driver following another vehicle must keep a distance that lets them stop safely without hitting it, considering speed, traffic and road conditions.' },
  { id: 'TN-545.151', cite: 'Tex. Transp. Code § 545.151', title: 'Vehicle approaching or entering intersection', url: url('TN', 545, '545.151'), audience: 'public', topics: ['intersection', 'right_of_way'],
    summary: 'Sets who must stop and yield when approaching an intersection, including obeying stop and yield signs.' },
  { id: 'TN-545.152', cite: 'Tex. Transp. Code § 545.152', title: 'Vehicle turning left', url: url('TN', 545, '545.152'), audience: 'public', topics: ['left_turn', 'right_of_way'],
    summary: 'A driver turning left must yield to oncoming vehicles that are in the intersection or close enough to be an immediate hazard.' },
  { id: 'TN-545.153', cite: 'Tex. Transp. Code § 545.153', title: 'Vehicle entering stop or yield intersection', url: url('TN', 545, '545.153'), audience: 'public', topics: ['stop_sign', 'right_of_way'],
    summary: 'At a stop or yield sign, the driver must stop or slow as required and yield to traffic that has the right-of-way.' },
  { id: 'TN-545.155', cite: 'Tex. Transp. Code § 545.155', title: 'Vehicle entering highway from private road or driveway', url: url('TN', 545, '545.155'), audience: 'public', topics: ['driveway', 'right_of_way'],
    summary: 'A driver pulling out of a driveway, alley or private road must yield to vehicles on the highway.' },
  { id: 'TN-545.351', cite: 'Tex. Transp. Code § 545.351', title: 'Maximum speed requirement', url: url('TN', 545, '545.351'), audience: 'public', topics: ['speed'],
    summary: 'Drivers may not go faster than is reasonable and prudent for the conditions, even below the posted limit.' },
  { id: 'TN-545.401', cite: 'Tex. Transp. Code § 545.401', title: 'Reckless driving', url: url('TN', 545, '545.401'), audience: 'public', topics: ['reckless'],
    summary: 'Driving with willful or wanton disregard for the safety of people or property is an offense.' },
  { id: 'TN-545.4251', cite: 'Tex. Transp. Code § 545.4251', title: 'Electronic messaging while driving', url: url('TN', 545, '545.4251'), audience: 'public', topics: ['distracted', 'phone'],
    summary: 'Reading, writing or sending electronic messages on a handheld device while driving is an offense unless the vehicle is stopped, with listed exceptions (hands-free, GPS, emergencies).' },
  // ---- Duties after a crash ----
  { id: 'TN-550.021', cite: 'Tex. Transp. Code § 550.021', title: 'Collision involving personal injury or death', url: url('TN', 550, '550.021'), audience: 'public', topics: ['hit_and_run', 'duties_after_crash'],
    summary: 'A driver in a crash that injures or may injure someone must stop, return to the scene, and stay until they have given information and rendered aid.' },
  { id: 'TN-550.022', cite: 'Tex. Transp. Code § 550.022', title: 'Collision involving damage to vehicle', url: url('TN', 550, '550.022'), audience: 'public', topics: ['hit_and_run', 'duties_after_crash'],
    summary: 'A driver in a crash that damages an occupied vehicle must stop and meet the duty to exchange information.' },
  { id: 'TN-550.023', cite: 'Tex. Transp. Code § 550.023', title: 'Duty to give information and render aid', url: url('TN', 550, '550.023'), audience: 'public', topics: ['duties_after_crash'],
    summary: 'Drivers in a crash must give their name, address, registration and insurer, show their license on request, and provide reasonable help to anyone injured.' },
  // ---- Insurance ----
  { id: 'TN-601.051', cite: 'Tex. Transp. Code § 601.051', title: 'Requirement of financial responsibility', url: url('TN', 601, '601.051'), audience: 'public', topics: ['insurance', 'uninsured'],
    summary: 'Texas requires proof of financial responsibility (usually liability insurance) to operate a vehicle.' },
  { id: 'TN-601.072', cite: 'Tex. Transp. Code § 601.072', title: 'Minimum coverage amounts', url: url('TN', 601, '601.072'), audience: 'public', topics: ['insurance', 'policy_limits'],
    summary: 'Minimum liability coverage is $30,000 per injured person and $60,000 per crash for bodily injury, plus property damage coverage. Actual policies may be higher; only the policy itself shows its limits.' },
  { id: 'IN-1952.101', cite: 'Tex. Ins. Code § 1952.101', title: 'Uninsured or underinsured motorist coverage', url: url('IN', 1952, '1952.101'), audience: 'public', topics: ['insurance', 'uninsured', 'underinsured', 'hit_and_run'],
    summary: 'Auto policies in Texas must include uninsured/underinsured motorist coverage unless the policyholder rejected it in writing.' },
  { id: 'IN-1952.152', cite: 'Tex. Ins. Code § 1952.152', title: 'Personal injury protection coverage required', url: url('IN', 1952, '1952.152'), audience: 'public', topics: ['insurance', 'pip'],
    summary: 'Auto policies in Texas must include personal injury protection (PIP) unless the policyholder rejected it in writing.' },
  // ---- Deadlines ----
  { id: 'CP-16.003', cite: 'Tex. Civ. Prac. & Rem. Code § 16.003', title: 'Two-year limitations period', url: url('CP', 16, '16.003'), audience: 'public', topics: ['deadline'],
    summary: 'Personal injury and property damage lawsuits generally must be filed within two years after the claim arises. Exceptions exist, so the exact deadline is a question for a lawyer.' },
  // ---- Attorney-only (liability analysis; never shown to visitors) ----
  { id: 'CP-33.001', cite: 'Tex. Civ. Prac. & Rem. Code § 33.001', title: 'Proportionate responsibility', url: url('CP', 33, '33.001'), audience: 'attorney', topics: ['comparative_responsibility'],
    summary: 'A claimant more than 50 percent responsible cannot recover damages.' },
  { id: 'CP-33.003', cite: 'Tex. Civ. Prac. & Rem. Code § 33.003', title: 'Determination of percentage of responsibility', url: url('CP', 33, '33.003'), audience: 'attorney', topics: ['comparative_responsibility'],
    summary: 'The trier of fact assigns a percentage of responsibility to each claimant, defendant, settling person and designated responsible third party.' },
  { id: 'CP-33.012', cite: 'Tex. Civ. Prac. & Rem. Code § 33.012', title: 'Amount of recovery', url: url('CP', 33, '33.012'), audience: 'attorney', topics: ['comparative_responsibility'],
    summary: "Damages are reduced by the claimant's own percentage of responsibility." },
  { id: 'PE-49.04', cite: 'Tex. Penal Code § 49.04', title: 'Driving while intoxicated', url: url('PE', 49, '49.04'), audience: 'attorney', topics: ['impaired'],
    summary: 'Operating a motor vehicle in a public place while intoxicated is an offense.' },
  { id: 'PE-49.07', cite: 'Tex. Penal Code § 49.07', title: 'Intoxication assault', url: url('PE', 49, '49.07'), audience: 'attorney', topics: ['impaired'],
    summary: 'Causing serious bodily injury to another by reason of intoxication while operating a motor vehicle in a public place is an offense.' },
];

const BY_ID = Object.fromEntries(LAWS.map((l) => [l.id, l]));
const IDS = LAWS.map((l) => l.id);
const PUBLIC_IDS = LAWS.filter((l) => l.audience === 'public').map((l) => l.id);

// Keep only ids that exist in the library (and, for visitors, only public ones). Anything else is dropped.
function resolve(items, { audience = 'public' } = {}) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    const law = BY_ID[it && it.id];
    if (!law || seen.has(law.id) || (audience === 'public' && law.audience !== 'public')) continue;
    seen.add(law.id);
    out.push({ ...law, why: String(it.why || '').slice(0, 600), verified_on: VERIFIED_ON });
  }
  return out;
}

// General two-year date from the crash date. Only an estimate of the general rule; exceptions exist.
function generalDeadline(crashDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(crashDate || '')) return null;
  const d = new Date(crashDate + 'T12:00:00Z');
  if (isNaN(d)) return null;
  d.setUTCFullYear(d.getUTCFullYear() + 2);
  return d.toISOString().slice(0, 10);
}

module.exports = { LAWS, BY_ID, IDS, PUBLIC_IDS, VERIFIED_ON, resolve, generalDeadline };
