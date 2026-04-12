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
  const vendors = db.prepare('SELECT * FROM vendors ORDER BY is_favorite DESC, name ASC').all();
  res.json(vendors);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name is required' });
  const str = (v) => (v === undefined || v === null || v === '') ? null : String(v).slice(0, 500);
  const result = db.prepare(`
    INSERT INTO vendors (name, category, phone, email, website, address, city, state, zip, notes, is_favorite)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.name, str(b.category) || 'Other', str(b.phone), str(b.email), str(b.website),
    str(b.address), str(b.city), str(b.state) || 'TX', str(b.zip), str(b.notes), b.is_favorite ? 1 : 0);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const b = req.body || {};
  const str = (v) => (v === undefined || v === null || v === '') ? null : String(v).slice(0, 500);
  db.prepare(`
    UPDATE vendors SET name=?, category=?, phone=?, email=?, website=?, address=?, city=?, state=?, zip=?, notes=?, is_favorite=?
    WHERE id=?
  `).run(b.name, str(b.category) || 'Other', str(b.phone), str(b.email), str(b.website),
    str(b.address), str(b.city), str(b.state) || 'TX', str(b.zip), str(b.notes), b.is_favorite ? 1 : 0, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM vendors WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.post('/:id/favorite', (req, res) => {
  const vendor = db.prepare('SELECT is_favorite FROM vendors WHERE id=?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE vendors SET is_favorite=? WHERE id=?').run(vendor.is_favorite ? 0 : 1, req.params.id);
  res.json({ is_favorite: !vendor.is_favorite });
});

router.post('/:id/used', (req, res) => {
  db.prepare("UPDATE vendors SET last_used=date('now') WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
