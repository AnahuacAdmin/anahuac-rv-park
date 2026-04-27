/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const { Resend } = require('resend');
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

router.use(authenticate);

const PARK_PREFIX = 'Anahuac RV Park: ';
const APP_URL = process.env.APP_URL || 'https://web-production-89794.up.railway.app';
const FROM_ADDRESS = 'Anahuac RV Park <invoices@anrvpark.com>';
const REPLY_TO = 'anrvpark@gmail.com'; // Keep Gmail as reply-to so replies go to inbox
const EMAIL_FOOTER_TEXT = '\n\n—\nAnahuac RV Park, LLC\n1003 Davis Ave, Anahuac, TX 77514\n409-267-6603\n\nYou are receiving this because you are a guest at Anahuac RV Park LLC. Call 409-267-6603 to opt out of email communications.';
const EMAIL_FOOTER_HTML = `
  <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #e7e5e4;font-size:12px;color:#78716c;line-height:1.6">
    <p style="margin:0"><strong>Anahuac RV Park, LLC</strong></p>
    <p style="margin:2px 0">1003 Davis Ave, Anahuac, TX 77514</p>
    <p style="margin:2px 0">Phone: <a href="tel:4092676603" style="color:#1a5c32">409-267-6603</a> | Email: <a href="mailto:support@anrvpark.com" style="color:#1a5c32">support@anrvpark.com</a></p>
    <p style="margin:8px 0 0;font-size:11px;color:#a8a29e">You are receiving this because you are a guest at Anahuac RV Park LLC, 1003 Davis Ave, Anahuac TX 77514. Call 409-267-6603 to opt out of email communications.</p>
  </div>`;

let _resend = null;
function getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Helper: send email to a single tenant via Resend
async function sendEmailToTenant(tenant, subject, bodyText) {
  const resend = getResend();
  if (!resend) {
    console.warn('[messages] Email not configured (RESEND_API_KEY missing). Skipping email.');
    return { sent: false, skipped: true, error: 'Email not configured' };
  }
  if (!tenant.email_opt_in || !tenant.email) {
    return { sent: false, skipped: true, error: 'No email or opted out' };
  }
  try {
    const emailSubject = subject
      ? `Hi ${tenant.first_name} — ${subject}`
      : `Hi ${tenant.first_name} — A message from Anahuac RV Park`;
    await resend.emails.send({
      from: FROM_ADDRESS,
      reply_to: REPLY_TO,
      to: tenant.email,
      subject: emailSubject,
      text: bodyText + EMAIL_FOOTER_TEXT,
      html: `<p>${bodyText.replace(/\n/g, '<br>')}</p>${EMAIL_FOOTER_HTML}`,
      headers: { 'List-Unsubscribe': '<mailto:support@anrvpark.com?subject=unsubscribe>' },
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

router.get('/', (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, t.first_name, t.last_name, t.lot_id
    FROM messages m
    LEFT JOIN tenants t ON m.tenant_id = t.id
    ORDER BY m.sent_date DESC
  `).all();
  res.json(messages);
});

// Send message — supports all delivery methods:
//   portal — save to tenant portal inbox (visible to tenant)
//   email  — save to portal + send email via Resend
//   sms    — save to portal + send SMS via Twilio
//   both   — save to portal + send email + send SMS
//   record — admin log only, NOT visible to tenant
router.post('/', async (req, res) => {
  const { tenant_id, subject, body, message_type, is_broadcast, delivery_method } = req.body;
  const dm = delivery_method || 'portal';
  const wantPortal = dm !== 'record';
  const wantSms = dm === 'sms' || dm === 'both';
  const wantEmail = dm === 'email' || dm === 'both';
  const smsBody = `${PARK_PREFIX}${subject ? subject + ' — ' : ''}${body}`;

  let smsSent = 0, smsFailed = 0, smsSkipped = 0;
  let emailSent = 0, emailFailed = 0, emailSkipped = 0;
  const errors = [];

  try {
    if (is_broadcast) {
      const tenants = db.prepare('SELECT id, first_name, last_name, phone, email, sms_opt_in, email_opt_in FROM tenants WHERE is_active = 1').all();
      const insert = db.prepare(
        'INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 1)'
      );

      for (const t of tenants) {
        // Portal: insert into messages table (visible to tenant)
        if (wantPortal) {
          insert.run(t.id, subject, body, message_type || 'notice');
        }

        // SMS
        if (wantSms) {
          if (!t.sms_opt_in || !t.phone) { smsSkipped++; }
          else {
            try { await sendSms(t.phone, smsBody); smsSent++; }
            catch (e) { smsFailed++; errors.push(`SMS tenant ${t.id}: ${e.message}`); }
          }
        }

        // Email
        if (wantEmail) {
          const r = await sendEmailToTenant(t, subject, body);
          if (r.sent) emailSent++;
          else if (r.skipped) emailSkipped++;
          else { emailFailed++; errors.push(`Email tenant ${t.id}: ${r.error}`); }
        }
      }

      res.json({
        sent: tenants.length, smsSent, smsFailed, smsSkipped,
        emailSent, emailFailed, emailSkipped, errors: errors.slice(0, 10)
      });
    } else {
      // Single-tenant message
      const t = db.prepare('SELECT id, first_name, last_name, phone, email, sms_opt_in, email_opt_in FROM tenants WHERE id = ?').get(tenant_id);

      // Portal: insert into messages table (visible to tenant)
      let insertId = null;
      if (wantPortal) {
        const result = db.prepare(
          'INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 0)'
        ).run(tenant_id, subject, body, message_type || 'notice');
        insertId = result.lastInsertRowid;
      }

      // SMS
      if (wantSms) {
        if (!t?.phone) {
          smsFailed = 1;
          errors.push('No phone on file');
        } else {
          try { await sendSms(t.phone, smsBody); smsSent = 1; }
          catch (e) { smsFailed = 1; errors.push(e.message); }
        }
      }

      // Email
      if (wantEmail && t) {
        const r = await sendEmailToTenant(t, subject, body);
        if (r.sent) emailSent = 1;
        else if (r.skipped) emailSkipped = 1;
        else { emailFailed = 1; errors.push(r.error); }
      }

      res.json({
        id: insertId, smsSent, smsFailed, smsSkipped,
        emailSent, emailFailed, emailSkipped, errors: errors.slice(0, 10)
      });
    }
  } catch (err) {
    console.error('[messages] send failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Emergency alert with portal/SMS/both delivery
router.post('/emergency-alert', async (req, res) => {
  try {
    const { delivery_type, subject, message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const tenants = db.prepare('SELECT id, first_name, last_name, lot_id, phone FROM tenants WHERE is_active = 1').all();
    const wantPortal = delivery_type === 'portal' || delivery_type === 'both';
    const wantSms = delivery_type === 'sms' || delivery_type === 'both';
    let messagesPosted = 0, smsSent = 0, smsFailed = 0;
    const errors = [];

    for (const t of tenants) {
      // Portal: insert in-app message
      if (wantPortal) {
        try {
          db.prepare('INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 1)')
            .run(t.id, subject || 'Emergency Alert', message, 'emergency_alert');
          messagesPosted++;
        } catch (e) { errors.push(`msg ${t.lot_id}: ${e.message}`); }
      }

      // SMS: send via Twilio
      if (wantSms && t.phone) {
        try {
          await sendSms(t.phone, `${PARK_PREFIX}🚨 ${subject || 'Emergency Alert'} — ${message}`);
          smsSent++;
        } catch (e) { smsFailed++; errors.push(`sms ${t.lot_id}: ${e.message}`); }
      }
    }

    res.json({ messagesPosted, smsSent, smsFailed, totalTenants: tenants.length, errors: errors.slice(0, 10) });
  } catch (err) {
    console.error('[messages] emergency-alert failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Advanced broadcast with opt-in filtering and multi-channel delivery.
router.post('/broadcast-advanced', async (req, res) => {
  try {
    const { message_type, recipients, delivery, message, subject } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Build tenant list based on recipient selection.
    let tenants;
    if (recipients === 'unpaid') {
      tenants = db.prepare(`
        SELECT DISTINCT t.* FROM tenants t
        JOIN invoices i ON i.tenant_id = t.id
        WHERE t.is_active = 1 AND i.balance_due > 0.005 AND i.status IN ('pending','partial') AND COALESCE(i.deleted,0) = 0
      `).all();
    } else if (recipients && recipients.startsWith('lot:')) {
      const lotId = recipients.replace('lot:', '');
      tenants = db.prepare('SELECT * FROM tenants WHERE is_active = 1 AND lot_id = ?').all(lotId);
    } else {
      tenants = db.prepare('SELECT * FROM tenants WHERE is_active = 1').all();
    }

    const wantSms = delivery === 'sms' || delivery === 'both';
    const wantEmail = delivery === 'email' || delivery === 'both';
    let smsSent = 0, smsFailed = 0, smsSkipped = 0;
    let emailSent = 0, emailFailed = 0, emailSkipped = 0;
    const errors = [];

    for (const t of tenants) {
      const personalMsg = message
        .replace(/\[name\]/gi, t.first_name)
        .replace(/\[lot\]/gi, t.lot_id || '');

      // Record in messages table (always visible to tenant in portal)
      db.prepare('INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 1)')
        .run(t.id, subject || message_type || 'Notification', personalMsg, message_type || 'notice');

      // SMS
      if (wantSms) {
        if (!t.sms_opt_in || !t.phone) { smsSkipped++; }
        else {
          try { await sendSms(t.phone, PARK_PREFIX + personalMsg); smsSent++; }
          catch (e) { smsFailed++; errors.push(`SMS ${t.lot_id}: ${e.message}`); }
        }
      }

      // Email
      if (wantEmail) {
        if (!t.email_opt_in || !t.email) { emailSkipped++; }
        else {
          const resend = getResend();
          if (!resend) { emailSkipped++; continue; }
          try {
            const emailSubject = subject
              ? `Hi ${t.first_name} — ${subject}`
              : `Hi ${t.first_name} — A message from Anahuac RV Park`;
            await resend.emails.send({
              from: FROM_ADDRESS,
              reply_to: REPLY_TO,
              to: t.email,
              subject: emailSubject,
              text: personalMsg + EMAIL_FOOTER_TEXT,
              html: `<p>${personalMsg.replace(/\n/g, '<br>')}</p>${EMAIL_FOOTER_HTML}`,
              headers: { 'List-Unsubscribe': '<mailto:support@anrvpark.com?subject=unsubscribe>' },
            });
            emailSent++;
          } catch (e) { emailFailed++; errors.push(`Email ${t.lot_id}: ${e.message}`); }
        }
      }
    }

    res.json({
      totalRecipients: tenants.length,
      smsSent, smsFailed, smsSkipped,
      emailSent, emailFailed, emailSkipped,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    console.error('[messages] broadcast-advanced failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
