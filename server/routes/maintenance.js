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
  if (req.user.role === 'admin') {
    res.json(db.prepare(`
      SELECT m.*, t.first_name, t.last_name FROM maintenance_requests m
      LEFT JOIN tenants t ON m.tenant_id = t.id
      ORDER BY CASE m.status WHEN 'submitted' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END, m.created_at DESC
    `).all());
  } else {
    res.json(db.prepare('SELECT * FROM maintenance_requests WHERE tenant_id = ? ORDER BY created_at DESC').all(req.user.id));
  }
});

// Submit request (tenant or admin)
router.post('/', async (req, res) => {
  var b = req.body || {};
  var result = db.prepare('INSERT INTO maintenance_requests (tenant_id, lot_id, category, description, photo) VALUES (?,?,?,?,?)').run(
    b.tenant_id || req.user.id, b.lot_id || null, b.category || 'Other', b.description || '', b.photo || null
  );
  // SMS to manager
  try {
    var mgrPhone = db.prepare("SELECT value FROM settings WHERE key='manager_phone'").get()?.value;
    if (mgrPhone) {
      var tenant = db.prepare('SELECT first_name, last_name, lot_id FROM tenants WHERE id=?').get(b.tenant_id || req.user.id);
      var name = tenant ? tenant.first_name + ' ' + tenant.last_name : 'Unknown';
      var lot = b.lot_id || (tenant && tenant.lot_id) || '?';
      await sendSms(mgrPhone, '🔧 Maintenance request from ' + name + ' Lot ' + lot + ': ' + (b.category || 'Other') + ' - ' + (b.description || '').slice(0, 100));
    }
  } catch (e) { console.error('[maintenance] SMS failed:', e.message); }
  res.json({ id: result.lastInsertRowid });
});

// Update status (admin)
router.put('/:id', async (req, res) => {
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
});

router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM maintenance_requests WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
