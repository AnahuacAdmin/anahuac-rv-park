/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const s of settings) obj[s.key] = s.value;
  res.json(obj);
});

const ALLOWED_SETTINGS = new Set([
  'electric_rate', 'park_name', 'park_address', 'park_phone', 'park_email',
  'late_fee_amount', 'late_fee_day', 'recovery_pin', 'wifi_password',
  'manager_phone', 'manager_email', 'auto_eviction_sms', 'auto_eviction_email',
  'reservation_nightly_rate', 'default_monthly_rate', 'default_daily_rate', 'default_weekly_rate',
  'default_rate_standard', 'default_rate_premium', 'default_rate_pullthrough',
  'default_flat_rate', 'loyalty_6mo', 'loyalty_12mo', 'loyalty_24mo',
  'referral_credit', 'auto_reminder_25', 'auto_reminder_1', 'auto_reminder_6',
  'alert_phone_numbers', 'downtime_alerts_enabled',
]);

router.put('/', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(?))');
  for (const [key, value] of Object.entries(req.body)) {
    if (!ALLOWED_SETTINGS.has(key)) continue;
    const sanitized = String(value).slice(0, 1000);
    update.run(key, sanitized, new Date().toISOString());
  }
  res.json({ success: true });
});

// --- Portal Restaurants CRUD (admin only) ---
router.get('/restaurants', (req, res) => {
  res.json(db.prepare('SELECT * FROM portal_restaurants ORDER BY display_order, id').all());
});

router.post('/restaurants', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  var maxOrder = db.prepare('SELECT COALESCE(MAX(display_order),0) as m FROM portal_restaurants').get().m;
  var r = db.prepare('INSERT INTO portal_restaurants (name, emoji, url, display_order, is_active) VALUES (?,?,?,?,?)').run(
    b.name, b.emoji || '🍽️', b.url || '', maxOrder + 1, b.is_active !== undefined ? (b.is_active ? 1 : 0) : 1
  );
  res.json({ id: r.lastInsertRowid });
});

router.put('/restaurants/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  db.prepare('UPDATE portal_restaurants SET name=?, emoji=?, url=?, is_active=? WHERE id=?').run(
    b.name, b.emoji || '🍽️', b.url || '', b.is_active ? 1 : 0, req.params.id
  );
  res.json({ success: true });
});

router.delete('/restaurants/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM portal_restaurants WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.put('/restaurants/reorder', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var order = req.body?.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  var stmt = db.prepare('UPDATE portal_restaurants SET display_order=? WHERE id=?');
  order.forEach(function(id, i) { stmt.run(i + 1, id); });
  res.json({ success: true });
});

module.exports = router;
