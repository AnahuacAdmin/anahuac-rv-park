/*
 * Anahuac RV Park — Employee & Owner Payment Tracking
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

router.get('/', (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const rows = db.prepare('SELECT * FROM employee_payments WHERE year = ? ORDER BY role, employee_name, month').all(year);
  res.json(rows);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.employee_name || !b.month || !b.year || !b.amount) return res.status(400).json({ error: 'Name, month, year, and amount required' });
  const result = db.prepare('INSERT INTO employee_payments (employee_name, role, month, year, amount, payment_method, notes) VALUES (?,?,?,?,?,?,?)')
    .run(b.employee_name, b.role || 'employee', b.month, b.year, Number(b.amount) || 0, b.payment_method || null, b.notes || null);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE employee_payments SET employee_name=?, role=?, month=?, year=?, amount=?, payment_method=?, notes=? WHERE id=?')
    .run(b.employee_name, b.role || 'employee', b.month, b.year, Number(b.amount) || 0, b.payment_method || null, b.notes || null, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM employee_payments WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Get distinct names for autocomplete
router.get('/names', (req, res) => {
  const names = db.prepare('SELECT DISTINCT employee_name, role FROM employee_payments ORDER BY role, employee_name').all();
  res.json(names);
});

module.exports = router;
