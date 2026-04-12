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

module.exports = router;
