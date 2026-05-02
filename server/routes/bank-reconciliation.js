/*
 * Anahuac RV Park — Bank Reconciliation API
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

router.get('/', (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const rows = db.prepare('SELECT * FROM bank_reconciliation WHERE year = ? ORDER BY month').all(year);
  res.json(rows);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.month || !b.year) return res.status(400).json({ error: 'Month and year required' });
  // Upsert
  const existing = db.prepare('SELECT id FROM bank_reconciliation WHERE month = ? AND year = ?').get(b.month, b.year);
  if (existing) {
    db.prepare('UPDATE bank_reconciliation SET beginning_balance=?, ending_balance=?, is_reconciled=?, notes=? WHERE id=?')
      .run(Number(b.beginning_balance) || 0, Number(b.ending_balance) || 0, b.is_reconciled ? 1 : 0, b.notes || null, existing.id);
    return res.json({ id: existing.id });
  }
  const result = db.prepare('INSERT INTO bank_reconciliation (month, year, beginning_balance, ending_balance, is_reconciled, notes) VALUES (?,?,?,?,?,?)')
    .run(b.month, b.year, Number(b.beginning_balance) || 0, Number(b.ending_balance) || 0, b.is_reconciled ? 1 : 0, b.notes || null);
  res.json({ id: result.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM bank_reconciliation WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
