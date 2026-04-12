const express = require('express');
const twilio = require('twilio');
const { db } = require('../database');
const { sendSms, normalizePhone } = require('../twilio');

const router = express.Router();

// Public endpoint — no auth. Twilio POSTs here when a tenant replies to an SMS.
router.post('/', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    // Verify Twilio webhook signature to prevent spoofed requests
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = req.headers['x-twilio-signature'] || '';
      const url = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`) + req.originalUrl;
      const valid = twilio.validateRequest(authToken, signature, url, req.body || {});
      if (!valid) {
        console.warn('[twilio-webhook] invalid signature — rejecting request');
        return res.status(403).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }
    } else {
      console.warn('[twilio-webhook] TWILIO_AUTH_TOKEN not set — skipping signature verification');
    }

    const from = req.body.From || '';
    const body = req.body.Body || '';
    console.log(`[twilio-webhook] incoming SMS from ${from}: ${body}`);

    // Look up tenant by phone
    const normalized = normalizePhone(from);
    let tenant = null;
    if (normalized) {
      // Try exact match, then partial (last 10 digits)
      const digits = normalized.replace(/\D/g, '').slice(-10);
      tenant = db.prepare("SELECT id, first_name, last_name, lot_id, phone FROM tenants WHERE is_active = 1 AND (phone = ? OR phone = ? OR phone LIKE ?)").get(normalized, from, `%${digits}`);
    }

    const tenantName = tenant ? `${tenant.first_name} ${tenant.last_name}` : 'Unknown';
    const lotId = tenant?.lot_id || '?';

    // Log in messages table
    if (tenant) {
      db.prepare("INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, 'sms_reply', 0)")
        .run(tenant.id, `SMS Reply from ${tenantName}`, body);
    }

    // Forward to manager
    const forwardMsg = `Reply from ${tenantName} (Lot ${lotId}): ${body}\nReply to: ${from}`;
    try {
      const mgrPhone = db.prepare("SELECT value FROM settings WHERE key = 'manager_phone'").get()?.value;
      if (mgrPhone) {
        await sendSms(mgrPhone, forwardMsg);
        console.log(`[twilio-webhook] forwarded to manager`);
      } else {
        console.warn('[twilio-webhook] no manager_phone in settings — cannot forward');
      }
    } catch (e) {
      console.error('[twilio-webhook] forward to manager failed:', e.message);
    }

    // Respond with TwiML (empty response — no auto-reply to tenant)
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (err) {
    console.error('[twilio-webhook] error:', err);
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

module.exports = router;
