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

// List all reservations, newest first.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, l.row_letter, l.lot_number
    FROM reservations r
    LEFT JOIN lots l ON r.lot_id = l.id
    ORDER BY r.arrival_date DESC
  `).all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT r.*, l.row_letter, l.lot_number
    FROM reservations r
    LEFT JOIN lots l ON r.lot_id = l.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Reservation not found' });
  res.json(row);
});

// Check lot availability for a date range.  Returns true if the lot is free.
function isLotAvailable(lotId, arrival, departure, excludeId) {
  const conflict = db.prepare(`
    SELECT id FROM reservations
    WHERE lot_id = ? AND status NOT IN ('cancelled', 'checked-out')
      AND arrival_date < ? AND departure_date > ?
      ${excludeId ? 'AND id != ?' : ''}
  `).get(...(excludeId ? [lotId, departure, arrival, excludeId] : [lotId, departure, arrival]));
  return !conflict;
}

// Availability endpoint for the frontend calendar / form.
router.get('/check-availability/:lotId', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  res.json({ available: isLotAvailable(req.params.lotId, from, to) });
});

// Create reservation.
router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.guest_name || !b.arrival_date || !b.departure_date) {
      return res.status(400).json({ error: 'Guest name, arrival, and departure dates are required' });
    }
    if (!b.lot_id) return res.status(400).json({ error: 'Lot is required' });

    if (!isLotAvailable(b.lot_id, b.arrival_date, b.departure_date)) {
      return res.status(409).json({ error: `Lot ${b.lot_id} is not available for those dates` });
    }

    const nights = Math.max(1, Math.round(
      (new Date(b.departure_date) - new Date(b.arrival_date)) / 86400000
    ));
    const rate = Number(b.rate_per_night) || 30;
    const total = +(nights * rate).toFixed(2);
    const deposit = Number(b.deposit_paid) || 0;
    const confNum = 'RES-' + Date.now().toString(36).toUpperCase();

    const result = db.prepare(`
      INSERT INTO reservations
        (guest_name, phone, email, lot_id, arrival_date, departure_date, nights, rate_per_night,
         total_amount, deposit_paid, status, notes, confirmation_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.guest_name, b.phone || null, b.email || null, b.lot_id,
      b.arrival_date, b.departure_date, nights, rate, total, deposit,
      b.status || 'pending', b.notes || null, confNum
    );
    res.json({ id: result.lastInsertRowid, confirmation_number: confNum, nights, total_amount: total });
  } catch (err) {
    console.error('[reservations] create failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update reservation.
router.put('/:id', (req, res) => {
  try {
    const b = req.body || {};
    const existing = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Reservation not found' });

    const lotId = b.lot_id || existing.lot_id;
    const arrival = b.arrival_date || existing.arrival_date;
    const departure = b.departure_date || existing.departure_date;

    if (lotId && !isLotAvailable(lotId, arrival, departure, existing.id)) {
      return res.status(409).json({ error: `Lot ${lotId} is not available for those dates` });
    }

    const nights = Math.max(1, Math.round((new Date(departure) - new Date(arrival)) / 86400000));
    const rate = Number(b.rate_per_night ?? existing.rate_per_night) || 50;
    const total = +(nights * rate).toFixed(2);
    const deposit = Number(b.deposit_paid ?? existing.deposit_paid) || 0;

    db.prepare(`
      UPDATE reservations SET
        guest_name=?, phone=?, email=?, lot_id=?, arrival_date=?, departure_date=?,
        nights=?, rate_per_night=?, total_amount=?, deposit_paid=?, status=?, notes=?
      WHERE id = ?
    `).run(
      b.guest_name || existing.guest_name,
      b.phone ?? existing.phone,
      b.email ?? existing.email,
      lotId, arrival, departure, nights, rate, total, deposit,
      b.status || existing.status,
      b.notes ?? existing.notes,
      req.params.id
    );
    res.json({ success: true, nights, total_amount: total });
  } catch (err) {
    console.error('[reservations] update failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Cancel.
router.post('/:id/cancel', (req, res) => {
  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// Convert to check-in: creates a tenant record + check-in record, marks reservation checked-in.
router.post('/:id/checkin', (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Reservation not found' });
    if (r.status === 'checked-in') return res.status(400).json({ error: 'Already checked in' });

    const nameParts = (r.guest_name || '').trim().split(/\s+/);
    const firstName = nameParts.slice(0, -1).join(' ') || nameParts[0] || 'Guest';
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

    const tenantResult = db.prepare(`
      INSERT INTO tenants (lot_id, first_name, last_name, phone, email, monthly_rent, rent_type, move_in_date, is_active, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'standard', ?, 1, ?)
    `).run(r.lot_id, firstName, lastName, r.phone, r.email, r.rate_per_night * 30, r.arrival_date,
      `Converted from reservation ${r.confirmation_number}`);

    db.prepare("UPDATE lots SET status = 'occupied' WHERE id = ?").run(r.lot_id);
    db.prepare("UPDATE reservations SET status = 'checked-in' WHERE id = ?").run(r.id);

    db.prepare(`
      INSERT INTO checkins (tenant_id, lot_id, check_in_date, status, notes)
      VALUES (?, ?, ?, 'checked_in', ?)
    `).run(tenantResult.lastInsertRowid, r.lot_id, r.arrival_date, `Reservation ${r.confirmation_number}`);

    res.json({ success: true, tenant_id: tenantResult.lastInsertRowid });
  } catch (err) {
    console.error('[reservations] checkin failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Calendar data: all non-cancelled reservations in a date window.
router.get('/calendar/range', (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to query params required' });
    const rows = db.prepare(`
      SELECT r.id, r.guest_name, r.lot_id, r.arrival_date, r.departure_date, r.status, r.confirmation_number
      FROM reservations r
      WHERE r.status != 'cancelled'
        AND r.arrival_date <= ? AND r.departure_date >= ?
      ORDER BY r.arrival_date
    `).all(to, from);
    res.json(rows);
  } catch (err) {
    console.error('[reservations] calendar range failed:', err);
    res.status(500).json({ error: 'Failed to load calendar data' });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reservations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- Group Reservations ---
router.get('/groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM reservation_groups ORDER BY arrival_date DESC').all();
  for (const g of groups) {
    g.lots = db.prepare('SELECT gl.*, r.status as res_status, r.confirmation_number FROM reservation_group_lots gl LEFT JOIN reservations r ON gl.reservation_id = r.id WHERE gl.group_id = ?').all(g.id);
  }
  res.json(groups);
});

router.get('/groups/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM reservation_groups WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });
  g.lots = db.prepare('SELECT gl.*, r.status as res_status, r.confirmation_number FROM reservation_group_lots gl LEFT JOIN reservations r ON gl.reservation_id = r.id WHERE gl.group_id = ?').all(g.id);
  res.json(g);
});

router.post('/group', (req, res) => {
  try {
    const b = req.body;
    if (!b.group_name || !b.arrival_date || !b.departure_date || !b.lots?.length) {
      return res.status(400).json({ error: 'Group name, dates, and at least one lot are required' });
    }
    const nights = Math.max(1, Math.round((new Date(b.departure_date) - new Date(b.arrival_date)) / 86400000));

    // Check all lots available
    for (const lot of b.lots) {
      if (!isLotAvailable(lot.lot_id, b.arrival_date, b.departure_date)) {
        return res.status(409).json({ error: `Lot ${lot.lot_id} is not available for those dates` });
      }
    }

    const gResult = db.prepare(`INSERT INTO reservation_groups (group_name, primary_contact_name, primary_contact_phone, primary_contact_email, arrival_date, departure_date, nights, billing_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(b.group_name, b.primary_contact_name || null, b.primary_contact_phone || null, b.primary_contact_email || null, b.arrival_date, b.departure_date, nights, b.billing_type || 'separate', b.notes || null);
    const groupId = gResult.lastInsertRowid;

    const rate = Number(b.rate_per_night) || 30;
    const lotResults = [];
    for (const lot of b.lots) {
      const confNum = 'RES-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
      const total = +(nights * rate).toFixed(2);
      const rResult = db.prepare(`INSERT INTO reservations (guest_name, phone, email, lot_id, arrival_date, departure_date, nights, rate_per_night, total_amount, deposit_paid, status, notes, confirmation_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`)
        .run(lot.occupant_name || b.primary_contact_name || b.group_name, b.primary_contact_phone || null, b.primary_contact_email || null, lot.lot_id, b.arrival_date, b.departure_date, nights, rate, total, `Group: ${b.group_name}`, confNum);
      db.prepare('INSERT INTO reservation_group_lots (group_id, lot_id, occupant_name, occupant_notes, reservation_id) VALUES (?, ?, ?, ?, ?)').run(groupId, lot.lot_id, lot.occupant_name || null, lot.occupant_notes || null, rResult.lastInsertRowid);
      lotResults.push({ lot_id: lot.lot_id, reservation_id: rResult.lastInsertRowid, confirmation_number: confNum });
    }

    res.json({ id: groupId, group_name: b.group_name, nights, lots: lotResults });
  } catch (err) {
    console.error('[reservations] group create failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/groups/:id', (req, res) => {
  const lots = db.prepare('SELECT reservation_id FROM reservation_group_lots WHERE group_id = ?').all(req.params.id);
  for (const l of lots) {
    if (l.reservation_id) db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(l.reservation_id);
  }
  db.prepare("UPDATE reservation_groups SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

router.post('/groups/:id/checkin-all', (req, res) => {
  try {
    const g = db.prepare('SELECT * FROM reservation_groups WHERE id = ?').get(req.params.id);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const lots = db.prepare('SELECT gl.*, r.id as res_id FROM reservation_group_lots gl LEFT JOIN reservations r ON gl.reservation_id = r.id WHERE gl.group_id = ?').all(g.id);
    let checkedIn = 0;
    for (const lot of lots) {
      const name = lot.occupant_name || g.primary_contact_name || g.group_name;
      const parts = name.trim().split(/\s+/);
      const firstName = parts.slice(0, -1).join(' ') || parts[0] || 'Guest';
      const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
      const tResult = db.prepare("INSERT INTO tenants (lot_id, first_name, last_name, phone, email, monthly_rent, rent_type, move_in_date, is_active, notes) VALUES (?, ?, ?, ?, ?, ?, 'standard', ?, 1, ?)")
        .run(lot.lot_id, firstName, lastName, g.primary_contact_phone, g.primary_contact_email, 50 * 30, g.arrival_date, `Group: ${g.group_name}`);
      db.prepare("UPDATE lots SET status = 'occupied' WHERE id = ?").run(lot.lot_id);
      db.prepare("INSERT INTO checkins (tenant_id, lot_id, check_in_date, status, notes) VALUES (?, ?, ?, 'checked_in', ?)").run(tResult.lastInsertRowid, lot.lot_id, g.arrival_date, `Group: ${g.group_name}`);
      if (lot.res_id) db.prepare("UPDATE reservations SET status = 'checked-in' WHERE id = ?").run(lot.res_id);
      checkedIn++;
    }
    db.prepare("UPDATE reservation_groups SET status = 'checked-in' WHERE id = ?").run(g.id);
    res.json({ success: true, checkedIn });
  } catch (err) {
    console.error('[reservations] group checkin failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
