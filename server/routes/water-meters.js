/*
 * Anahuac RV Park — Water Meter Tracking
 */
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'water-meters');

// === SETTINGS ===
router.get('/settings', (req, res) => {
  var row = db.prepare('SELECT * FROM water_settings WHERE id=1').get();
  res.json(row || {});
});

router.put('/settings', (req, res) => {
  var b = req.body || {};
  db.prepare(`UPDATE water_settings SET
    rate_per_gallon=?, service_fee_percent=?, billing_enabled=?,
    monthly_allowance_gallons=?, overage_only_mode=?, evaluation_mode=?
    WHERE id=1`).run(
    Number(b.rate_per_gallon) || 0,
    Math.min(Number(b.service_fee_percent) || 0, 9),
    b.billing_enabled ? 1 : 0,
    b.monthly_allowance_gallons ? Number(b.monthly_allowance_gallons) : null,
    b.overage_only_mode ? 1 : 0,
    b.evaluation_mode ? 1 : 0
  );
  res.json({ success: true });
});

// === READINGS ===
router.get('/readings', (req, res) => {
  var q = req.query;
  var sql = `SELECT r.*, t.first_name, t.last_name
    FROM water_readings r
    LEFT JOIN tenants t ON r.lot_id = t.lot_id AND t.is_active = 1
    WHERE 1=1`;
  var params = [];
  if (q.lot_id) { sql += ' AND r.lot_id=?'; params.push(q.lot_id); }
  if (q.month) { sql += ' AND r.reading_date LIKE ?'; params.push(q.month + '%'); }
  if (q.from) { sql += ' AND r.reading_date>=?'; params.push(q.from); }
  if (q.to) { sql += ' AND r.reading_date<=?'; params.push(q.to); }
  sql += ' ORDER BY r.reading_date DESC, r.lot_id';
  var rows = db.prepare(sql).all(...params);
  rows.forEach(function(r) { r.has_photo = !!r.photo_path; });
  res.json(rows);
});

router.post('/readings', (req, res) => {
  var b = req.body || {};
  if (!b.lot_id || !b.reading_date) return res.status(400).json({ error: 'lot_id and reading_date required' });

  var prev = Number(b.previous_reading) || 0;
  var curr = Number(b.current_reading) || 0;
  var gallons = Math.max(0, curr - prev);

  // Calculate estimated charge
  var settings = db.prepare('SELECT * FROM water_settings WHERE id=1').get() || {};
  var rate = Number(settings.rate_per_gallon) || 0;
  var feePct = Math.min(Number(settings.service_fee_percent) || 0, 9);
  var allowance = settings.monthly_allowance_gallons ? Number(settings.monthly_allowance_gallons) : null;
  var charge = 0;

  if (!settings.evaluation_mode) {
    var billableGallons = gallons;
    if (settings.overage_only_mode && allowance) {
      billableGallons = Math.max(0, gallons - allowance);
    }
    charge = billableGallons * rate;
    charge = charge + (charge * feePct / 100);
    charge = Math.round(charge * 100) / 100;
  }

  var result = db.prepare(`INSERT INTO water_readings
    (lot_id, reading_date, previous_reading, current_reading, gallons_used, estimated_charge, notes)
    VALUES (?,?,?,?,?,?,?)`).run(
    b.lot_id, b.reading_date, prev, curr, gallons, charge, b.notes || null
  );
  res.json({ id: result.lastInsertRowid, gallons_used: gallons, estimated_charge: charge });
});

router.put('/readings/:id', (req, res) => {
  var b = req.body || {};
  var prev = Number(b.previous_reading) || 0;
  var curr = Number(b.current_reading) || 0;
  var gallons = Math.max(0, curr - prev);

  var settings = db.prepare('SELECT * FROM water_settings WHERE id=1').get() || {};
  var rate = Number(settings.rate_per_gallon) || 0;
  var feePct = Math.min(Number(settings.service_fee_percent) || 0, 9);
  var allowance = settings.monthly_allowance_gallons ? Number(settings.monthly_allowance_gallons) : null;
  var charge = 0;
  if (!settings.evaluation_mode) {
    var billableGallons = gallons;
    if (settings.overage_only_mode && allowance) billableGallons = Math.max(0, gallons - allowance);
    charge = billableGallons * rate * (1 + feePct / 100);
    charge = Math.round(charge * 100) / 100;
  }

  db.prepare(`UPDATE water_readings SET lot_id=?, reading_date=?, previous_reading=?,
    current_reading=?, gallons_used=?, estimated_charge=?, notes=? WHERE id=?`).run(
    b.lot_id, b.reading_date, prev, curr, gallons, charge, b.notes || null, req.params.id
  );
  res.json({ success: true });
});

router.delete('/readings/:id', (req, res) => {
  db.prepare('DELETE FROM water_readings WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === PHOTO UPLOAD ===
router.post('/readings/:id/photo', (req, res) => {
  var b = req.body || {};
  if (!b.data) return res.status(400).json({ error: 'Photo data required' });
  try {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    var filename = 'water-' + req.params.id + '-' + Date.now() + '.jpg';
    var filepath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(b.data, 'base64'));
    db.prepare('UPDATE water_readings SET photo_path=? WHERE id=?').run(filename, req.params.id);
    res.json({ success: true, filename: filename });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save photo: ' + e.message });
  }
});

router.get('/readings/:id/photo', (req, res) => {
  var row = db.prepare('SELECT photo_path FROM water_readings WHERE id=?').get(req.params.id);
  if (!row || !row.photo_path) return res.status(404).send('No photo');
  var filepath = path.join(UPLOAD_DIR, row.photo_path);
  if (!fs.existsSync(filepath)) return res.status(404).send('File not found');
  res.sendFile(filepath);
});

// === ANALYTICS ===
router.get('/analytics', (req, res) => {
  var now = new Date();
  var currentMonth = now.toISOString().slice(0, 7);

  // This month summary
  var monthTotal = db.prepare("SELECT COALESCE(SUM(gallons_used),0) as g, COUNT(*) as c FROM water_readings WHERE reading_date LIKE ?").get(currentMonth + '%');
  var totalLots = db.prepare("SELECT COUNT(*) as c FROM lots WHERE status IN ('occupied','vacant') AND is_active=1").get().c;

  // Monthly history (last 6 months)
  var monthlyHistory = [];
  for (var i = 5; i >= 0; i--) {
    var d = new Date(); d.setMonth(d.getMonth() - i);
    var m = d.toISOString().slice(0, 7);
    var row = db.prepare("SELECT COALESCE(SUM(gallons_used),0) as gallons, COUNT(*) as readings FROM water_readings WHERE reading_date LIKE ?").get(m + '%');
    monthlyHistory.push({ month: m, gallons: row.gallons, readings: row.readings });
  }

  // Top 10 usage this month
  var topUsage = db.prepare(`
    SELECT r.lot_id, t.first_name, t.last_name, SUM(r.gallons_used) as total_gallons
    FROM water_readings r
    LEFT JOIN tenants t ON r.lot_id = t.lot_id AND t.is_active=1
    WHERE r.reading_date LIKE ?
    GROUP BY r.lot_id ORDER BY total_gallons DESC LIMIT 10
  `).all(currentMonth + '%');

  // All lots with 3-month average
  var threeMonthsAgo = new Date(); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  var lotStats = db.prepare(`
    SELECT r.lot_id, t.first_name, t.last_name,
      SUM(CASE WHEN r.reading_date LIKE ? THEN r.gallons_used ELSE 0 END) as this_month,
      AVG(r.gallons_used) as avg_gallons,
      COUNT(*) as total_readings
    FROM water_readings r
    LEFT JOIN tenants t ON r.lot_id = t.lot_id AND t.is_active=1
    WHERE r.reading_date >= ?
    GROUP BY r.lot_id ORDER BY this_month DESC
  `).all(currentMonth + '%', threeMonthsAgo.toISOString().slice(0, 10));

  // Settings for allowance comparison
  var settings = db.prepare('SELECT * FROM water_settings WHERE id=1').get() || {};

  res.json({
    currentMonth,
    totalGallons: monthTotal.g,
    readingsCount: monthTotal.c,
    totalLots,
    avgPerLot: monthTotal.c > 0 ? Math.round(monthTotal.g / monthTotal.c) : 0,
    monthlyHistory,
    topUsage,
    lotStats,
    allowance: settings.monthly_allowance_gallons,
    evaluationMode: settings.evaluation_mode,
  });
});

// === CSV EXPORT ===
router.get('/export/csv', (req, res) => {
  var q = req.query;
  var sql = `SELECT r.lot_id, t.first_name, t.last_name, r.reading_date,
    r.previous_reading, r.current_reading, r.gallons_used, r.estimated_charge,
    CASE WHEN r.photo_path IS NOT NULL THEN 'Yes' ELSE 'No' END as photo_on_file, r.notes
    FROM water_readings r
    LEFT JOIN tenants t ON r.lot_id = t.lot_id AND t.is_active=1 WHERE 1=1`;
  var params = [];
  if (q.month) { sql += ' AND r.reading_date LIKE ?'; params.push(q.month + '%'); }
  if (q.from) { sql += ' AND r.reading_date>=?'; params.push(q.from); }
  if (q.to) { sql += ' AND r.reading_date<=?'; params.push(q.to); }
  sql += ' ORDER BY r.reading_date DESC, r.lot_id';
  var rows = db.prepare(sql).all(...params);

  var esc = function(v) { var s = String(v == null ? '' : v); if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; };
  var lines = ['Lot,Tenant Name,Reading Date,Previous Reading,Current Reading,Gallons Used,Estimated Charge,Photo On File,Notes'];
  rows.forEach(function(r) {
    var name = ((r.first_name || '') + ' ' + (r.last_name || '')).trim();
    lines.push([r.lot_id, name, r.reading_date, r.previous_reading, r.current_reading, r.gallons_used, Number(r.estimated_charge).toFixed(2), r.photo_on_file, r.notes].map(esc).join(','));
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="water-readings.csv"');
  res.send(lines.join('\n') + '\n');
});

module.exports = router;
