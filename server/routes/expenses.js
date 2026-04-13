/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

router.get('/', (req, res) => {
  var q = req.query;
  var sql = 'SELECT * FROM expenses WHERE 1=1';
  var params = [];
  if (q.category && q.category !== 'all') { sql += ' AND category=?'; params.push(q.category); }
  if (q.from) { sql += ' AND expense_date>=?'; params.push(q.from); }
  if (q.to) { sql += ' AND expense_date<=?'; params.push(q.to); }
  sql += ' ORDER BY expense_date DESC';
  var rows = db.prepare(sql).all(...params);
  rows.forEach(function(r) { r.has_receipt = !!r.receipt_photo; delete r.receipt_photo; });
  res.json(rows);
});

router.get('/summary', (req, res) => {
  var month = req.query.month || new Date().toISOString().slice(0, 7);
  var total = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE expense_date LIKE ?").get(month + '%').t;
  var byCategory = db.prepare("SELECT category, COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date LIKE ? GROUP BY category ORDER BY total DESC").all(month + '%');
  res.json({ month: month, total: total, byCategory: byCategory });
});

router.get('/:id/receipt', (req, res) => {
  var row = db.prepare('SELECT receipt_photo FROM expenses WHERE id=?').get(req.params.id);
  if (!row || !row.receipt_photo) return res.status(404).json({ error: 'No receipt' });
  var buf = Buffer.from(row.receipt_photo, 'base64');
  res.set('Content-Type', 'image/jpeg');
  res.send(buf);
});

router.post('/', (req, res) => {
  var b = req.body || {};
  if (!b.expense_date || !b.amount) return res.status(400).json({ error: 'Date and amount required' });
  var result = db.prepare('INSERT INTO expenses (expense_date, category, description, amount, receipt_photo, vendor, paid_by) VALUES (?,?,?,?,?,?,?)').run(
    b.expense_date, b.category || 'Other', b.description || '', Number(b.amount) || 0, b.receipt_photo || null, b.vendor || null, b.paid_by || null
  );
  res.json({ id: result.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
