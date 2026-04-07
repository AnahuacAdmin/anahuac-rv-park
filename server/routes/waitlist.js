const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const entries = db.prepare('SELECT * FROM waitlist WHERE status = ? ORDER BY position, date_added').all('waiting');
  res.json(entries);
});

router.get('/all', (req, res) => {
  const entries = db.prepare('SELECT * FROM waitlist ORDER BY status, position, date_added').all();
  res.json(entries);
});

router.post('/', (req, res) => {
  const { first_name, last_name, phone, email, rv_length, preferred_lot, notes } = req.body;
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) as max FROM waitlist WHERE status = ?').get('waiting');
  const result = db.prepare(`
    INSERT INTO waitlist (first_name, last_name, phone, email, rv_length, preferred_lot, notes, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(first_name, last_name, phone, email, rv_length, preferred_lot, notes, (maxPos.max || 0) + 1);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { first_name, last_name, phone, email, rv_length, preferred_lot, notes, status } = req.body;
  db.prepare(`
    UPDATE waitlist SET first_name=?, last_name=?, phone=?, email=?, rv_length=?, preferred_lot=?, notes=?, status=?
    WHERE id = ?
  `).run(first_name, last_name, phone, email, rv_length, preferred_lot, notes, status || 'waiting', req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM waitlist WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
