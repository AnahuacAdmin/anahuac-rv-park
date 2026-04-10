const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

router.use(authenticate);

const PARK_PREFIX = 'Anahuac RV Park: ';

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

module.exports = router;
