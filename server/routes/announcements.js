/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');
const pushService = require('../services/push-notifications');

// Public: active announcements for portal
router.get('/public', (req, res) => {
  res.json(db.prepare("SELECT id, title, message, is_pinned, created_at FROM announcements WHERE (expires_at IS NULL OR expires_at >= date('now')) ORDER BY is_pinned DESC, created_at DESC LIMIT 5").all());
});

router.use(authenticate);

// Admin: all announcements
router.get('/', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(db.prepare('SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC').all());
});

router.post('/', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Title required' });
  var result = db.prepare('INSERT INTO announcements (title, message, is_pinned, expires_at) VALUES (?,?,?,?)').run(
    b.title, b.message || '', b.is_pinned ? 1 : 0, b.expires_at || null
  );
  // Push to all tenants
  try { pushService.notifyAllTenants({ type: 'announcement', title: '\ud83d\udce2 From Park Management', body: (b.title + (b.message ? ' \u2014 ' + b.message : '')).substring(0, 150), url: '/portal', priority: b.is_pinned ? 'critical' : 'normal' }); } catch {}
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  db.prepare('UPDATE announcements SET title=?, message=?, is_pinned=?, expires_at=? WHERE id=?').run(
    b.title, b.message || '', b.is_pinned ? 1 : 0, b.expires_at || null, req.params.id
  );
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
