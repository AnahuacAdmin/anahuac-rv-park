const router = require('express').Router();
const { Resend } = require('resend');
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

router.use(authenticate);

const PARK_PREFIX = 'Anahuac RV Park: ';
const APP_URL = process.env.APP_URL || 'https://web-production-89794.up.railway.app';

let _resend = null;
function getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
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

router.post('/', async (req, res) => {
  const { tenant_id, subject, body, message_type, is_broadcast, delivery_method } = req.body;
  const wantsSms = delivery_method === 'sms';
  const smsBody = `${PARK_PREFIX}${subject ? subject + ' — ' : ''}${body}`;

  let smsSent = 0;
  let smsFailed = 0;
  const errors = [];

  try {
    if (is_broadcast) {
      const tenants = db.prepare('SELECT id, phone FROM tenants WHERE is_active = 1').all();
      const insert = db.prepare(`
        INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 1)
      `);
      for (const t of tenants) {
        insert.run(t.id, subject, body, message_type || 'notice');
        if (wantsSms && t.phone) {
          try { await sendSms(t.phone, smsBody); smsSent++; }
          catch (e) { smsFailed++; errors.push(`tenant ${t.id}: ${e.message}`); }
        }
      }
      res.json({ sent: tenants.length, smsSent, smsFailed, errors });
    } else {
      const result = db.prepare(`
        INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 0)
      `).run(tenant_id, subject, body, message_type || 'notice');
      if (wantsSms) {
        const t = db.prepare('SELECT phone FROM tenants WHERE id = ?').get(tenant_id);
        if (!t?.phone) {
          return res.json({ id: result.lastInsertRowid, smsSent: 0, smsFailed: 1, errors: ['No phone on file'] });
        }
        try { await sendSms(t.phone, smsBody); smsSent = 1; }
        catch (e) { smsFailed = 1; errors.push(e.message); }
      }
      res.json({ id: result.lastInsertRowid, smsSent, smsFailed, errors });
    }
  } catch (err) {
    console.error('[messages] send failed:', err);
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

      // Record in messages table
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
            await resend.emails.send({
              from: 'Anahuac RV Park <invoices@anrvpark.com>',
              reply_to: 'anrvpark@gmail.com',
              to: t.email,
              subject: subject || `Anahuac RV Park - ${message_type || 'Notice'}`,
              text: personalMsg + '\n\nAnahuac RV Park\n409-267-6603',
              html: `<p>${personalMsg.replace(/\n/g, '<br>')}</p><p>Anahuac RV Park<br>409-267-6603</p>`,
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
