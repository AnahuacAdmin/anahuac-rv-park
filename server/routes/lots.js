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
    SELECT l.*, t.id as tenant_id, t.first_name, t.last_name, t.monthly_rent, t.rent_type, t.eviction_warning
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
    const status = req.body.status ?? existing.status;
    const validStatuses = ['vacant', 'occupied', 'owner_reserved', 'maintenance'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid lot status' });
    const notes = req.body.notes ?? existing.notes;
    const size_restriction = req.body.size_restriction ?? existing.size_restriction;
    db.prepare('UPDATE lots SET status = ?, notes = ?, size_restriction = ? WHERE id = ?')
      .run(status, notes, size_restriction, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[lots] update lot failed:', err);
    res.status(500).json({ error: 'Failed to update lot' });
  }
});

module.exports = router;
