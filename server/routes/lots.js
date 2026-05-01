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
  const lots = db.prepare(`
    SELECT l.*, t.id as tenant_id, t.first_name, t.last_name, t.monthly_rent, t.rent_type, t.eviction_warning, t.flat_rate, t.deposit_waived, t.deposit_amount,
      (SELECT COUNT(*) FROM tenant_vehicles WHERE tenant_id = t.id) AS vehicle_count,
      (SELECT COUNT(*) FROM tenant_occupants WHERE tenant_id = t.id) AS occupant_count
    FROM lots l
    LEFT JOIN tenants t ON l.id = t.lot_id AND t.is_active = 1
    GROUP BY l.id
    ORDER BY l.row_letter, l.lot_number
  `).all();

  const today = new Date().toISOString().split('T')[0];
  for (const lot of lots) {
    lot.payment_flag = null;
    lot.balance_due = 0;
    // If lot is not occupied, clear any stale tenant data from the LEFT JOIN
    if (lot.status !== 'occupied') {
      lot.tenant_id = null; lot.first_name = null; lot.last_name = null;
      lot.eviction_warning = null;
    }
    if (!lot.tenant_id) continue;
    const inv = db.prepare(`
      SELECT COALESCE(SUM(balance_due),0) as balance,
             COALESCE(SUM(amount_paid),0) as paid,
             MIN(due_date) as earliest_due
      FROM invoices WHERE tenant_id = ? AND balance_due > 0.005
    `).get(lot.tenant_id);
    lot.balance_due = inv.balance || 0;
    if (lot.balance_due > 0.005) {
      if ((inv.paid || 0) > 0) {
        lot.payment_flag = 'partial';
      } else if (inv.earliest_due && inv.earliest_due < today) {
        lot.payment_flag = 'overdue';
      } else {
        lot.payment_flag = 'unpaid';
      }
    }
  }
  res.json(lots);
});

router.get('/:id', (req, res) => {
  try {
    const lot = db.prepare(`
      SELECT l.*, t.id as tenant_id, t.first_name, t.last_name, t.monthly_rent, t.phone, t.email, t.rent_type
      FROM lots l
      LEFT JOIN tenants t ON l.id = t.lot_id AND t.is_active = 1
      WHERE l.id = ?
    `).get(req.params.id);
    if (!lot) return res.status(404).json({ error: 'Lot not found' });
    res.json(lot);
  } catch (err) {
    console.error('[lots] get lot failed:', err);
    res.status(500).json({ error: 'Failed to load lot' });
  }
});

router.get('/:id/detail', (req, res) => {
  const row = db.prepare(`
    SELECT l.*, t.id as tenant_id, t.first_name, t.last_name, t.phone, t.email,
      t.monthly_rent, t.rent_type, t.move_in_date, t.rv_make, t.rv_model, t.rv_year,
      t.rv_length, t.license_plate, t.emergency_contact, t.emergency_phone,
      t.eviction_warning, t.notes as tenant_notes
    FROM lots l
    LEFT JOIN tenants t ON l.id = t.lot_id AND t.is_active = 1
    WHERE l.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Lot not found' });

  // Separate lot and tenant fields so lot.id stays correct.
  const lot = { id: row.id, row_letter: row.row_letter, lot_number: row.lot_number, width: row.width, length: row.length, status: row.status, notes: row.notes, size_restriction: row.size_restriction };
  const tenant = row.tenant_id ? row : null;

  const result = { lot, tenant: null, currentInvoice: null, invoices: [], payments: [], meters: [], messages: [] };
  if (tenant) {
    result.tenant = tenant;
    result.invoices = db.prepare(
      'SELECT * FROM invoices WHERE tenant_id = ? ORDER BY invoice_date DESC LIMIT 6'
    ).all(tenant.tenant_id);
    result.currentInvoice = result.invoices.find(i => i.balance_due > 0.005) || result.invoices[0] || null;
    result.payments = db.prepare(
      'SELECT * FROM payments WHERE tenant_id = ? ORDER BY payment_date DESC LIMIT 12'
    ).all(tenant.tenant_id);
    result.meters = db.prepare(
      'SELECT * FROM meter_readings WHERE tenant_id = ? ORDER BY reading_date DESC LIMIT 3'
    ).all(tenant.tenant_id);
    result.messages = db.prepare(
      'SELECT * FROM messages WHERE tenant_id = ? ORDER BY sent_date DESC LIMIT 20'
    ).all(tenant.tenant_id);
  }
  res.json(result);
});

router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM lots WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lot not found' });
    const b = req.body;
    const status = b.status ?? existing.status;
    const validStatuses = ['vacant', 'occupied', 'owner_reserved', 'maintenance'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid lot status' });
    const notes = b.notes ?? existing.notes;
    const size_restriction = b.size_restriction ?? existing.size_restriction;
    const lot_type = b.lot_type ?? existing.lot_type ?? 'standard';
    const amenities = b.amenities ?? existing.amenities ?? '';
    const default_rate = b.default_rate !== undefined ? Number(b.default_rate) : (existing.default_rate || 295);
    const width = b.width !== undefined ? parseInt(b.width) : existing.width;
    const length = b.length !== undefined ? parseInt(b.length) : existing.length;
    db.prepare('UPDATE lots SET status=?, notes=?, size_restriction=?, lot_type=?, amenities=?, default_rate=?, width=?, length=? WHERE id=?')
      .run(status, notes, size_restriction, lot_type, amenities, default_rate, width, length, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[lots] update lot failed:', err);
    res.status(500).json({ error: 'Failed to update lot' });
  }
});

router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.id || !b.row_letter) return res.status(400).json({ error: 'Lot ID and row letter are required' });
    const existing = db.prepare('SELECT id FROM lots WHERE id = ?').get(b.id);
    if (existing) return res.status(409).json({ error: 'Lot ID already exists' });

    const lot_number = parseInt(b.lot_number) || 1;
    const width = parseInt(b.width) || 30;
    const length = parseInt(b.length) || 60;
    const status = b.status || 'vacant';
    const lot_type = b.lot_type || 'standard';
    const amenities = b.amenities || '';
    const default_rate = Number(b.default_rate) || 295;
    const notes = b.notes || null;
    const size_restriction = b.size_restriction || null;

    db.prepare(`
      INSERT INTO lots (id, row_letter, lot_number, width, length, status, lot_type, amenities, default_rate, notes, size_restriction, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(b.id.toUpperCase(), b.row_letter.toUpperCase(), lot_number, width, length, status, lot_type, amenities, default_rate, notes, size_restriction);

    res.json({ success: true, id: b.id.toUpperCase() });
  } catch (err) {
    console.error('[lots] create failed:', err);
    res.status(500).json({ error: 'Failed to create lot' });
  }
});

router.put('/:id/short-term', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  var lot = db.prepare('SELECT id, short_term_only FROM lots WHERE id = ?').get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  var newVal = req.body.short_term_only !== undefined ? (req.body.short_term_only ? 1 : 0) : (lot.short_term_only ? 0 : 1);
  db.prepare('UPDATE lots SET short_term_only = ? WHERE id = ?').run(newVal, req.params.id);
  res.json({ success: true, short_term_only: newVal });
});

router.post('/:id/deactivate', (req, res) => {
  try {
    const lot = db.prepare('SELECT id, status FROM lots WHERE id = ?').get(req.params.id);
    if (!lot) return res.status(404).json({ error: 'Lot not found' });
    if (lot.status === 'occupied') return res.status(400).json({ error: 'Cannot deactivate an occupied lot' });
    db.prepare('UPDATE lots SET is_active = 0, status = ? WHERE id = ?').run('maintenance', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[lots] deactivate failed:', err);
    res.status(500).json({ error: 'Failed to deactivate lot' });
  }
});

router.post('/:id/activate', (req, res) => {
  try {
    db.prepare('UPDATE lots SET is_active = 1, status = ? WHERE id = ?').run('vacant', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[lots] activate failed:', err);
    res.status(500).json({ error: 'Failed to activate lot' });
  }
});

// Rename/relabel a lot ID with cascade update across all tables
router.post('/:id/rename', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  var oldId = req.params.id;
  var newId = (req.body.new_id || '').trim().toUpperCase();
  if (!newId) return res.status(400).json({ error: 'New lot ID is required' });
  if (newId === oldId) return res.status(400).json({ error: 'New ID is the same as current ID' });

  var existing = db.prepare('SELECT id FROM lots WHERE id = ?').get(oldId);
  if (!existing) return res.status(404).json({ error: 'Lot not found' });

  var conflict = db.prepare('SELECT id FROM lots WHERE id = ?').get(newId);
  if (conflict) return res.status(409).json({ error: 'Lot ID "' + newId + '" already exists' });

  // Count affected records for confirmation
  var counts = {
    tenants: db.prepare('SELECT COUNT(*) as c FROM tenants WHERE lot_id = ?').get(oldId).c,
    invoices: db.prepare('SELECT COUNT(*) as c FROM invoices WHERE lot_id = ?').get(oldId).c,
    meters: db.prepare('SELECT COUNT(*) as c FROM meter_readings WHERE lot_id = ?').get(oldId).c,
    checkins: db.prepare('SELECT COUNT(*) as c FROM checkins WHERE lot_id = ?').get(oldId).c,
  };
  var resCounts = 0;
  try { resCounts = db.prepare('SELECT COUNT(*) as c FROM reservations WHERE lot_id = ?').get(oldId).c; } catch {}
  counts.reservations = resCounts;

  // If dry_run, just return counts
  if (req.body.dry_run) return res.json({ oldId: oldId, newId: newId, counts: counts });

  // Execute in transaction
  try {
    var tx = db.transaction(function() {
      db.prepare('UPDATE lots SET id = ? WHERE id = ?').run(newId, oldId);
      db.prepare('UPDATE tenants SET lot_id = ? WHERE lot_id = ?').run(newId, oldId);
      db.prepare('UPDATE invoices SET lot_id = ? WHERE lot_id = ?').run(newId, oldId);
      db.prepare('UPDATE meter_readings SET lot_id = ? WHERE lot_id = ?').run(newId, oldId);
      db.prepare('UPDATE checkins SET lot_id = ? WHERE lot_id = ?').run(newId, oldId);
      try { db.prepare('UPDATE reservations SET lot_id = ? WHERE lot_id = ?').run(newId, oldId); } catch {}
      // Also update last_move_old_lot_id references
      db.prepare('UPDATE tenants SET last_move_old_lot_id = ? WHERE last_move_old_lot_id = ?').run(newId, oldId);
    });
    tx();
    console.log('[lots] renamed ' + oldId + ' → ' + newId + ', counts:', JSON.stringify(counts));
    res.json({ success: true, oldId: oldId, newId: newId, counts: counts });
  } catch (err) {
    console.error('[lots] rename failed:', err);
    res.status(500).json({ error: 'Rename failed: ' + err.message });
  }
});

module.exports = router;
