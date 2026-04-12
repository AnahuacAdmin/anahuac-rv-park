/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
// Thin Twilio wrapper. Lazy-loaded so missing env vars don't crash boot.
let _client = null;
function getClient() {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  console.log(`[twilio] config check: SID=${sid ? sid.slice(0,6) + '...' : 'MISSING'}, TOKEN=${token ? '***set***' : 'MISSING'}, FROM=${from || 'MISSING'}`);
  if (!sid || !token || !from) {
    throw new Error('Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.');
  }
  _client = require('twilio')(sid, token);
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
  console.log(`[twilio] sending SMS to ${to} from ${process.env.TWILIO_PHONE_NUMBER}`);
  const client = getClient();
  const msg = await client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
    body,
  });
  console.log(`[twilio] SMS sent, sid=${msg.sid}, status=${msg.status}`);
  return { sid: msg.sid, to };
}

module.exports = { sendSms, normalizePhone };
