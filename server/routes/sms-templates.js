/*
 * Anahuac RV Park — SMS Templates
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM sms_templates ORDER BY category, name').all());
});

router.post('/', (req, res) => {
  var b = req.body || {};
  if (!b.name || !b.message) return res.status(400).json({ error: 'Name and message required' });
  var r = db.prepare('INSERT INTO sms_templates (name, message, category) VALUES (?,?,?)').run(b.name, b.message, b.category || 'general');
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  var b = req.body || {};
  db.prepare('UPDATE sms_templates SET name=?, message=?, category=? WHERE id=?').run(b.name, b.message, b.category || 'general', req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM sms_templates WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
