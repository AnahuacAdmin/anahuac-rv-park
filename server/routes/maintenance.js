/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

router.use(authenticate);

// List all requests (admin) or tenant's own
router.get('/', (req, res) => {
  var rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`
      SELECT m.*, t.first_name, t.last_name FROM maintenance_requests m
      LEFT JOIN tenants t ON m.tenant_id = t.id
      ORDER BY CASE m.status WHEN 'submitted' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END, m.created_at DESC
    `).all();
  } else {
    rows = db.prepare('SELECT * FROM maintenance_requests WHERE tenant_id = ? ORDER BY created_at DESC').all(req.user.id);
  }
  // Don't send raw photo data in list — use has_photo flag + /photo endpoint
  rows.forEach(function(r) { r.has_photo = !!r.photo; delete r.photo; });
  res.json(rows);
});

// Submit request (tenant or admin)
router.post('/', async (req, res) => {
  try {
  var b = req.body || {};
  var result = db.prepare('INSERT INTO maintenance_requests (tenant_id, lot_id, category, description, photo) VALUES (?,?,?,?,?)').run(
    b.tenant_id || req.user.id, b.lot_id || null, b.category || 'Other', b.description || '', b.photo || null
  );
  // SMS to manager with photo note
  try {
    var mgrPhone = db.prepare("SELECT value FROM settings WHERE key='manager_phone'").get()?.value;
    if (mgrPhone) {
      var tenant = db.prepare('SELECT first_name, last_name, lot_id FROM tenants WHERE id=?').get(b.tenant_id || req.user.id);
      var name = tenant ? tenant.first_name + ' ' + tenant.last_name : 'Unknown';
      var lot = b.lot_id || (tenant && tenant.lot_id) || '?';
      var APP_URL = process.env.APP_URL || 'https://web-production-89794.up.railway.app';
      var msg = '🔧 MAINTENANCE REQUEST\nFrom: ' + name + ' - Lot ' + lot + '\nCategory: ' + (b.category || 'Other') + '\nProblem: ' + (b.description || '').slice(0, 80);
      if (b.photo) msg += '\n📷 Photo attached — view in admin app';
      msg += '\nView: ' + APP_URL + ' → Maintenance';
      await sendSms(mgrPhone, msg);
    }
  } catch (e) { console.error('[maintenance] SMS failed:', e.message); }
  res.json({ id: result.lastInsertRowid });
  } catch (err) { console.error('[maintenance] create error:', err.message); res.status(500).json({ error: 'Failed to create request' }); }
});

// Update status (admin)
router.put('/:id', async (req, res) => {
  try {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  var resolved = b.status === 'resolved' ? new Date().toISOString() : null;
  db.prepare('UPDATE maintenance_requests SET status=?, resolution_notes=?, resolved_at=COALESCE(?,resolved_at) WHERE id=?').run(
    b.status || 'submitted', b.resolution_notes || null, resolved, req.params.id
  );
  // SMS tenant on resolve
  if (b.status === 'resolved') {
    try {
      var req2 = db.prepare('SELECT tenant_id FROM maintenance_requests WHERE id=?').get(req.params.id);
      var tenant = req2 ? db.prepare('SELECT first_name, phone FROM tenants WHERE id=?').get(req2.tenant_id) : null;
      if (tenant && tenant.phone) {
        await sendSms(tenant.phone, '✅ ' + tenant.first_name + ', your maintenance request has been resolved! Contact us at 409-267-6603 if you have any issues.');
      }
    } catch (e) { console.error('[maintenance] resolve SMS failed:', e.message); }
  }
  res.json({ success: true });
  } catch (err) { console.error('[maintenance] update error:', err.message); res.status(500).json({ error: 'Failed to update request' }); }
});

// Serve maintenance photo
router.get('/:id/photo', (req, res) => {
  var row = db.prepare('SELECT photo FROM maintenance_requests WHERE id=?').get(req.params.id);
  if (!row || !row.photo) return res.status(404).send('No photo');
  var buf = Buffer.from(row.photo, 'base64');
  res.set('Content-Type', 'image/jpeg');
  res.send(buf);
});

router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM maintenance_requests WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
