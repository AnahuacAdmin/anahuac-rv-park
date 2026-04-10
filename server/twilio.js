// Thin Twilio wrapper. Lazy-loaded so missing env vars don't crash boot.
let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    throw new Error('Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.');
  }
  _client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return _client;
}

// Normalize a US phone number to E.164. Returns null if it can't.
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (raw.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

async function sendSms(toRaw, body) {
  const to = normalizePhone(toRaw);
  if (!to) throw new Error(`Invalid phone number: ${toRaw}`);
  const client = getClient();
  const msg = await client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
    body,
  });
  return { sid: msg.sid, to };
}

module.exports = { sendSms, normalizePhone };
