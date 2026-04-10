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
    const rate = Number(b.rate_per_night) || 50;
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
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reservations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
