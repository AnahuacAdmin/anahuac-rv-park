/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const fs = require('fs');
const express = require('express');
const { db, reloadDatabase, saveDb, DB_PATH } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Last backup metadata stored as a setting key.
router.get('/backup-info', requireAdmin, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'last_backup_at'").get();
  res.json({ lastBackupAt: row?.value || null });
});

// Download the entire .sqlite file. Forces a save first so the file on disk
// reflects any pending in-memory writes from the auto-save interval.
router.get('/backup', requireAdmin, (req, res) => {
  try {
    saveDb();
    if (!fs.existsSync(DB_PATH)) return res.status(500).json({ error: 'Database file not found' });
    const today = new Date().toISOString().split('T')[0];
    const filename = `rvpark-backup-${today}.sqlite`;

    const nowIso = new Date().toISOString();
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run('last_backup_at', nowIso, nowIso);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(DB_PATH);
    stream.pipe(res);
  } catch (err) {
    console.error('[admin] backup failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Restore from an uploaded .sqlite file. Body is the raw file bytes.
// Use express.raw at this route only so we don't disturb the JSON parser.
router.post('/restore',
  requireAdmin,
  express.raw({ type: 'application/octet-stream', limit: '50mb' }),
  async (req, res) => {
    try {
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'No file uploaded' });
      // SQLite files start with the magic string "SQLite format 3\0"
      const magic = req.body.slice(0, 16).toString('utf8');
      if (!magic.startsWith('SQLite format 3')) {
        return res.status(400).json({ error: 'Uploaded file does not appear to be a valid SQLite database' });
      }
      await reloadDatabase(req.body);
      res.json({ success: true, sizeBytes: req.body.length });
    } catch (err) {
      console.error('[admin] restore failed:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Emergency CSV data export — all critical data as individual CSVs
router.get('/emergency-export', requireAdmin, (req, res) => {
  try {
    var esc = function(v) { var s = String(v == null ? '' : v); if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; };

    var tenants = db.prepare('SELECT * FROM tenants WHERE is_active=1 ORDER BY lot_id').all();
    var tenantsCsv = 'Lot,First Name,Last Name,Phone,Email,Monthly Rent,Rent Type,Move In Date,RV Make,RV Model,RV Length,License Plate,Notes\n' +
      tenants.map(function(t) { return [t.lot_id,t.first_name,t.last_name,t.phone,t.email,t.monthly_rent,t.rent_type,t.move_in_date,t.rv_make,t.rv_model,t.rv_length,t.license_plate,t.notes].map(esc).join(','); }).join('\n');

    var invoices = db.prepare('SELECT i.*, t.first_name, t.last_name FROM invoices i LEFT JOIN tenants t ON i.tenant_id=t.id WHERE COALESCE(i.deleted,0)=0 ORDER BY i.invoice_date DESC LIMIT 500').all();
    var invoicesCsv = 'Invoice #,Lot,Tenant,Date,Rent,Electric,Total,Paid,Balance,Status\n' +
      invoices.map(function(i) { return [i.invoice_number,i.lot_id,i.first_name+' '+i.last_name,i.invoice_date,i.rent_amount,i.electric_amount,i.total_amount,i.amount_paid,i.balance_due,i.status].map(esc).join(','); }).join('\n');

    var payments = db.prepare('SELECT p.*, t.first_name, t.last_name FROM payments p LEFT JOIN tenants t ON p.tenant_id=t.id ORDER BY p.payment_date DESC LIMIT 500').all();
    var paymentsCsv = 'Date,Tenant,Amount,Method,Invoice #,Notes\n' +
      payments.map(function(p) { return [p.payment_date,(p.first_name||'')+' '+(p.last_name||''),p.amount,p.payment_method,p.invoice_number,p.notes].map(esc).join(','); }).join('\n');

    var meters = db.prepare('SELECT * FROM meter_readings ORDER BY reading_date DESC LIMIT 500').all();
    var metersCsv = 'Lot,Date,Previous,Current,kWh Used,Charge\n' +
      meters.map(function(m) { return [m.lot_id,m.reading_date,m.previous_reading,m.current_reading,m.kwh_used,m.electric_charge].map(esc).join(','); }).join('\n');

    var settings = db.prepare('SELECT * FROM settings').all();
    var settingsJson = JSON.stringify(settings.reduce(function(o,s) { o[s.key] = s.value; return o; }, {}), null, 2);

    var contacts = tenants.filter(function(t) { return t.phone; }).map(function(t) {
      return [t.lot_id, t.first_name + ' ' + t.last_name, t.phone, t.email || '', t.emergency_contact || '', t.emergency_phone || ''].map(esc).join(',');
    });
    var contactsCsv = 'Lot,Name,Phone,Email,Emergency Contact,Emergency Phone\n' + contacts.join('\n');

    // Record backup timestamp
    var now = new Date().toISOString();
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(?))').run('last_backup_at', now, now);

    // Return as JSON with all CSV data (client will create files)
    res.json({
      timestamp: now,
      files: {
        'tenants.csv': tenantsCsv,
        'invoices.csv': invoicesCsv,
        'payments.csv': paymentsCsv,
        'meter_readings.csv': metersCsv,
        'settings.json': settingsJson,
        'emergency_contacts.csv': contactsCsv,
      }
    });
  } catch (err) {
    console.error('[admin] emergency export failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Auto Message Log ---
router.get('/message-log', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const offset = parseInt(req.query.offset) || 0;
    const typeFilter = req.query.type || '';

    let sql = 'SELECT * FROM auto_message_log';
    const params = [];
    if (typeFilter) {
      sql += ' WHERE message_type = ?';
      params.push(typeFilter);
    }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params);
    const total = db.prepare('SELECT COUNT(*) as c FROM auto_message_log' + (typeFilter ? ' WHERE message_type = ?' : '')).get(...(typeFilter ? [typeFilter] : []));
    res.json({ rows, total: total.c });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
