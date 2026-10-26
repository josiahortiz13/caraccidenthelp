// Email provider order: Resend first, Gmail as backup, failure only when both fail.
process.env.PGLITE = '1';
process.env.EMAIL_FAKE = '1';
const test = require('node:test');
const assert = require('node:assert');
const email = require('../lib/email');

function reset({ resend = true, gmail = true } = {}) {
  email.fake.sent.length = 0;
  email.fake.fail = false;
  email.fake.resendFail = false;
  if (resend) process.env.RESEND_API_KEY = 're_test'; else delete process.env.RESEND_API_KEY;
  if (gmail) process.env.GMAIL_APP_PASSWORD = 'abcdabcdabcdabcd'; else delete process.env.GMAIL_APP_PASSWORD;
}

test('Resend is used first when configured', async () => {
  reset();
  const r = await email.send({ to: 'firm@example.com', subject: 's', text: 't', purpose: 'owner_alert_email' });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'resend');
  assert.deepEqual(email.fake.sent.map((m) => m.provider), ['resend']);
});

test('Gmail takes over when Resend fails', async () => {
  reset();
  email.fake.resendFail = true;
  const r = await email.send({ to: 'firm@example.com', subject: 's', text: 't', purpose: 'owner_alert_email' });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'gmail');
  assert.deepEqual(email.fake.sent.map((m) => m.provider), ['gmail']);
});

test('Gmail alone still works (current production setup)', async () => {
  reset({ resend: false });
  const r = await email.send({ to: 'firm@example.com', subject: 's', text: 't' });
  assert.equal(r.provider, 'gmail');
});

test('Reports failure only when every provider fails', async () => {
  reset();
  email.fake.fail = true;
  const r = await email.send({ to: 'firm@example.com', subject: 's', text: 't' });
  assert.equal(r.ok, false);
  assert.match(r.error, /resend: .*\| gmail: /);
});

test.after(() => { delete process.env.RESEND_API_KEY; delete process.env.GMAIL_APP_PASSWORD; });
