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
  'late_fee_amount', 'late_fee_day', 'late_fee_type', 'late_fee_percentage',
  'late_fee_grace_days', 'late_fee_mode', 'late_fee_email', 'late_fee_sms_number',
  'late_fee_email_enabled', 'late_fee_sms_enabled',
  'recovery_pin', 'wifi_password',
  'manager_phone', 'manager_email', 'auto_eviction_sms', 'auto_eviction_email',
  'reservation_nightly_rate', 'default_monthly_rate', 'default_daily_rate', 'default_weekly_rate',
  'default_rate_standard', 'default_rate_premium', 'default_rate_pullthrough',
  'default_flat_rate', 'loyalty_6mo', 'loyalty_12mo', 'loyalty_24mo',
  'referral_credit', 'auto_reminder_25', 'auto_reminder_1', 'auto_reminder_6',
  'alert_phone_numbers', 'downtime_alerts_enabled', 'weather_alerts_enabled',
  'daily_reminder_enabled', 'auto_birthday_enabled',
  'brand_accent_color', 'park_website',
  'setup_wizard_completed', 'support_email',
  'review_request_enabled', 'google_review_url', 'review_request_cooldown_days',
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

// --- First-time setup wizard ---
// Saves park info, creates lots, optionally changes password — all in one call.
router.post('/setup-wizard', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const b = req.body || {};
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(?))');
  const now = new Date().toISOString();

  // Park info
  if (b.park_name) upsert.run('park_name', String(b.park_name).slice(0, 200), now);
  if (b.park_address) upsert.run('park_address', String(b.park_address).slice(0, 500), now);
  if (b.park_phone) upsert.run('park_phone', String(b.park_phone).slice(0, 30), now);
  if (b.park_email) upsert.run('park_email', String(b.park_email).slice(0, 200), now);
  if (b.park_website) upsert.run('park_website', String(b.park_website).slice(0, 500), now);

  // Rates
  if (b.default_monthly_rate) upsert.run('default_monthly_rate', String(Number(b.default_monthly_rate) || 295), now);
  if (b.electric_rate) upsert.run('electric_rate', String(Number(b.electric_rate) || 0.15), now);

  // Lot generation — creates rows A-1..A-N (or A-1, B-1, etc. in rows of 10)
  var lotsCreated = 0;
  var lotCount = parseInt(b.lot_count) || 0;
  if (lotCount > 0 && lotCount <= 500) {
    var rate = Number(b.default_monthly_rate) || 295;
    var existing = db.prepare('SELECT COUNT(*) as c FROM lots').get().c;
    if (existing === 0) {
      // Generate lots in rows of up to 20: A-1..A-20, B-1..B-20, etc.
      var perRow = 20;
      for (var i = 0; i < lotCount; i++) {
        var row = String.fromCharCode(65 + Math.floor(i / perRow)); // A, B, C...
        var num = (i % perRow) + 1;
        var lotId = row + '-' + num;
        try {
          db.prepare('INSERT INTO lots (id, row_letter, lot_number, status, default_rate, is_active) VALUES (?,?,?,?,?,1)')
            .run(lotId, row, num, 'vacant', rate);
          lotsCreated++;
        } catch { /* lot already exists */ }
      }
    }
  }

  // Password change (optional)
  var passwordChanged = false;
  if (b.new_password && b.new_password.length >= 6) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(b.new_password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
    passwordChanged = true;
  }

  // Mark wizard as complete
  upsert.run('setup_wizard_completed', '1', now);

  res.json({ success: true, lotsCreated, passwordChanged });
});

// --- Support contact email ---
router.post('/support-request', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Login required' });
  const b = req.body || {};
  if (!b.message || !String(b.message).trim()) return res.status(400).json({ error: 'Message is required' });

  const mgrEmail = db.prepare("SELECT value FROM settings WHERE key='manager_email'").get()?.value
    || db.prepare("SELECT value FROM settings WHERE key='park_email'").get()?.value;

  // Store support request as a simple log entry — and attempt to email if Resend is configured
  const name = String(b.name || req.user?.username || 'Unknown').trim();
  const email = String(b.email || '').trim();
  const message = String(b.message).trim().slice(0, 5000);

  // Try to send via Resend if available
  if (mgrEmail && process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      resend.emails.send({
        from: 'LotMate Support <invoices@anrvpark.com>',
        reply_to: email || undefined,
        to: mgrEmail,
        subject: 'Support Request from ' + name,
        text: 'Name: ' + name + '\nEmail: ' + email + '\n\nMessage:\n' + message,
      }).catch(function(e) { console.error('[support] email failed:', e.message); });
    } catch (e) { console.error('[support] Resend not available:', e.message); }
  }

  console.log('[support] request from', name, ':', message.slice(0, 100));
  res.json({ success: true });
});

// --- Branding image upload / serve ---
// Images are stored as base64 in the settings table under keys
// 'brand_logo' and 'brand_banner'. Served as binary blobs on GET.
const BRAND_IMAGE_KEYS = { logo: 'brand_logo', banner: 'brand_banner' };
const BRAND_IMAGE_LIMITS = { logo: 2 * 1024 * 1024, banner: 5 * 1024 * 1024 };

router.post('/branding/image/:type', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const type = req.params.type;
  const key = BRAND_IMAGE_KEYS[type];
  if (!key) return res.status(400).json({ error: 'Invalid image type (logo or banner)' });

  const { data, mime } = req.body || {};
  if (!data || !mime) return res.status(400).json({ error: 'data and mime are required' });
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) {
    return res.status(400).json({ error: 'Unsupported image type. Use JPG, PNG, GIF, or WebP.' });
  }
  // data is base64 — check decoded size
  const sizeBytes = Math.ceil((data.length * 3) / 4);
  const limit = BRAND_IMAGE_LIMITS[type];
  if (sizeBytes > limit) {
    return res.status(400).json({ error: `Image too large. Max ${limit / 1024 / 1024}MB.` });
  }
  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(?))')
    .run(key, JSON.stringify({ data, mime }), now);
  res.json({ success: true });
});

router.delete('/branding/image/:type', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const key = BRAND_IMAGE_KEYS[req.params.type];
  if (!key) return res.status(400).json({ error: 'Invalid image type' });
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  res.json({ success: true });
});

// Serve branding images as binary — no auth required so the browser can use
// them as <img src> in the sidebar, login screen, invoices, etc.
router.get('/branding/image/:type', (req, res) => {
  const key = BRAND_IMAGE_KEYS[req.params.type];
  if (!key) return res.status(400).json({ error: 'Invalid image type' });
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row?.value) return res.status(404).send('No image');
  try {
    const { data, mime } = JSON.parse(row.value);
    const buf = Buffer.from(data, 'base64');
    res.set('Content-Type', mime);
    res.set('Cache-Control', 'public, max-age=300');
    res.send(buf);
  } catch {
    res.status(500).send('Corrupt image data');
  }
});

// --- Portal Local Links CRUD (admin only) ---
router.get('/local-links', (req, res) => {
  res.json(db.prepare('SELECT * FROM portal_local_links ORDER BY category, display_order, id').all());
});

router.post('/local-links', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  var maxOrder = db.prepare('SELECT COALESCE(MAX(display_order),0) as m FROM portal_local_links WHERE category=?').get(b.category || 'attraction').m;
  var r = db.prepare('INSERT INTO portal_local_links (category, name, emoji, url, display_order, is_active) VALUES (?,?,?,?,?,?)').run(
    b.category || 'attraction', b.name, b.emoji || '🔗', b.url || '', maxOrder + 1, b.is_active !== undefined ? (b.is_active ? 1 : 0) : 1
  );
  res.json({ id: r.lastInsertRowid });
});

router.put('/local-links/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  db.prepare('UPDATE portal_local_links SET category=?, name=?, emoji=?, url=?, is_active=? WHERE id=?').run(
    b.category || 'attraction', b.name, b.emoji || '🔗', b.url || '', b.is_active ? 1 : 0, req.params.id
  );
  res.json({ success: true });
});

router.delete('/local-links/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM portal_local_links WHERE id=?').run(req.params.id);
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
