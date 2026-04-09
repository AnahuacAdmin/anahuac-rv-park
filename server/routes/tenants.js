const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const tenants = db.prepare(`
    SELECT t.*, l.row_letter, l.lot_number
    FROM tenants t
    LEFT JOIN lots l ON t.lot_id = l.id
    WHERE t.is_active = 1
    ORDER BY t.lot_id
  `).all();
  res.json(tenants);
});

router.get('/all', (req, res) => {
  const tenants = db.prepare(`
    SELECT t.*, l.row_letter, l.lot_number
    FROM tenants t
    LEFT JOIN lots l ON t.lot_id = l.id
    ORDER BY t.is_active DESC, t.lot_id
  `).all();
  res.json(tenants);
});

router.get('/:id', (req, res) => {
  const tenant = db.prepare(`
    SELECT t.*, l.row_letter, l.lot_number, l.id as lot_id
    FROM tenants t
    LEFT JOIN lots l ON t.lot_id = l.id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json(tenant);
});

router.post('/', (req, res) => {
  const { lot_id, first_name, last_name, phone, email, emergency_contact, emergency_phone,
    rv_make, rv_model, rv_year, rv_length, license_plate, monthly_rent, rent_type, move_in_date, notes,
    recurring_late_fee, recurring_mailbox_fee, recurring_misc_fee, recurring_misc_description,
    recurring_credit, recurring_credit_description } = req.body;
  const result = db.prepare(`
    INSERT INTO tenants (lot_id, first_name, last_name, phone, email, emergency_contact, emergency_phone,
      rv_make, rv_model, rv_year, rv_length, license_plate, monthly_rent, rent_type, move_in_date, notes,
      recurring_late_fee, recurring_mailbox_fee, recurring_misc_fee, recurring_misc_description,
      recurring_credit, recurring_credit_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lot_id, first_name, last_name, phone, email, emergency_contact, emergency_phone,
    rv_make, rv_model, rv_year, rv_length, license_plate, monthly_rent || 295, rent_type || 'standard', move_in_date, notes,
    recurring_late_fee || 0, recurring_mailbox_fee || 0, recurring_misc_fee || 0, recurring_misc_description,
    recurring_credit || 0, recurring_credit_description);
  if (lot_id) {
    db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('occupied', lot_id);
  }
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { lot_id, first_name, last_name, phone, email, emergency_contact, emergency_phone,
    rv_make, rv_model, rv_year, rv_length, license_plate, monthly_rent, rent_type, move_in_date, notes,
    recurring_late_fee, recurring_mailbox_fee, recurring_misc_fee, recurring_misc_description,
    recurring_credit, recurring_credit_description } = req.body;
  db.prepare(`
    UPDATE tenants SET lot_id=?, first_name=?, last_name=?, phone=?, email=?, emergency_contact=?,
      emergency_phone=?, rv_make=?, rv_model=?, rv_year=?, rv_length=?, license_plate=?,
      monthly_rent=?, rent_type=?, move_in_date=?, notes=?,
      recurring_late_fee=?, recurring_mailbox_fee=?, recurring_misc_fee=?, recurring_misc_description=?,
      recurring_credit=?, recurring_credit_description=?
    WHERE id = ?
  `).run(lot_id, first_name, last_name, phone, email, emergency_contact, emergency_phone,
    rv_make, rv_model, rv_year, rv_length, license_plate, monthly_rent, rent_type, move_in_date, notes,
    recurring_late_fee || 0, recurring_mailbox_fee || 0, recurring_misc_fee || 0, recurring_misc_description,
    recurring_credit || 0, recurring_credit_description, req.params.id);
  res.json({ success: true });
});

// Move a tenant to a different lot in one atomic step:
//  - validate the destination is vacant (or the tenant's current lot)
//  - update tenant.lot_id
//  - mark the old lot vacant, the new lot occupied
//  - create a zero-value meter reading on the new lot so it shows up on the meters page
router.post('/:id/move', (req, res) => {
  try {
    const { new_lot_id } = req.body || {};
    if (!new_lot_id) return res.status(400).json({ error: 'new_lot_id is required' });

    const tenant = db.prepare('SELECT id, lot_id, first_name, last_name FROM tenants WHERE id = ? AND is_active = 1').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (tenant.lot_id === new_lot_id) return res.status(400).json({ error: 'Tenant is already on this lot' });

    const newLot = db.prepare('SELECT id, status FROM lots WHERE id = ?').get(new_lot_id);
    if (!newLot) return res.status(404).json({ error: 'Destination lot not found' });
    if (newLot.status !== 'vacant') return res.status(400).json({ error: `Lot ${new_lot_id} is not vacant (status: ${newLot.status})` });

    const oldLotId = tenant.lot_id;

    db.prepare('UPDATE tenants SET lot_id = ? WHERE id = ?').run(new_lot_id, tenant.id);
    if (oldLotId) {
      db.prepare("UPDATE lots SET status = 'vacant' WHERE id = ?").run(oldLotId);
    }
    db.prepare("UPDATE lots SET status = 'occupied' WHERE id = ?").run(new_lot_id);

    // Seed a placeholder meter reading on the new lot so the meters page shows it.
    const today = new Date().toISOString().split('T')[0];
    const existing = db.prepare('SELECT id FROM meter_readings WHERE tenant_id = ? AND lot_id = ?').get(tenant.id, new_lot_id);
    if (!existing) {
      db.prepare(`
        INSERT INTO meter_readings (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge)
        VALUES (?, ?, ?, 0, 0, 0, 0.15, 0)
      `).run(new_lot_id, tenant.id, today);
    }

    res.json({
      success: true,
      tenant: `${tenant.first_name} ${tenant.last_name}`,
      from: oldLotId,
      to: new_lot_id,
    });
  } catch (err) {
    console.error('[tenants] move failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const tenant = db.prepare('SELECT lot_id FROM tenants WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE tenants SET is_active = 0, move_out_date = date(?) WHERE id = ?')
    .run(new Date().toISOString().split('T')[0], req.params.id);
  if (tenant?.lot_id) {
    db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('vacant', tenant.lot_id);
  }
  res.json({ success: true });
});

module.exports = router;
