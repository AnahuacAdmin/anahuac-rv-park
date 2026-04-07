const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, t.first_name, t.last_name, t.lot_id
    FROM messages m
    LEFT JOIN tenants t ON m.tenant_id = t.id
    ORDER BY m.sent_date DESC
  `).all();
  res.json(messages);
});

router.post('/', (req, res) => {
  const { tenant_id, subject, body, message_type, is_broadcast } = req.body;

  if (is_broadcast) {
    const tenants = db.prepare('SELECT id FROM tenants WHERE is_active = 1').all();
    const insert = db.prepare(`
      INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 1)
    `);
    for (const t of tenants) {
      insert.run(t.id, subject, body, message_type || 'notice');
    }
    res.json({ sent: tenants.length });
  } else {
    const result = db.prepare(`
      INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 0)
    `).run(tenant_id, subject, body, message_type || 'notice');
    res.json({ id: result.lastInsertRowid });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
