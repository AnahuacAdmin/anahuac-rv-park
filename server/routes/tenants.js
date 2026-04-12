const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const tenants = db.prepare(`
    SELECT t.*, l.row_letter, l.lot_number,
      COALESCE((SELECT SUM(i.balance_due) FROM invoices i WHERE i.tenant_id = t.id AND i.status IN ('pending','partial') AND COALESCE(i.deleted,0) = 0), 0) AS balance_due
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
  try {
    const b = req.body || {};
    if (!b.first_name || !b.last_name) return res.status(400).json({ error: 'First and last name are required' });

    // sql.js rejects `undefined` — coerce missing strings to null and numbers to 0.
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
    const num = (v) => Number(v) || 0;

    const result = db.prepare(`
      INSERT INTO tenants (lot_id, first_name, last_name, phone, email, emergency_contact, emergency_phone,
        rv_make, rv_model, rv_year, rv_length, license_plate, monthly_rent, rent_type, move_in_date, notes,
        recurring_late_fee, recurring_mailbox_fee, recurring_misc_fee, recurring_misc_description,
        recurring_credit, recurring_credit_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      str(b.lot_id), b.first_name, b.last_name, str(b.phone), str(b.email),
      str(b.emergency_contact), str(b.emergency_phone),
      str(b.rv_make), str(b.rv_model), str(b.rv_year), str(b.rv_length), str(b.license_plate),
      num(b.monthly_rent) || 295, b.rent_type || 'standard', str(b.move_in_date), str(b.notes),
      num(b.recurring_late_fee), num(b.recurring_mailbox_fee), num(b.recurring_misc_fee),
      str(b.recurring_misc_description), num(b.recurring_credit), str(b.recurring_credit_description)
    );
    if (b.lot_id) {
      db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('occupied', b.lot_id);
    }
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    console.error('[tenants] create failed:', err);
    res.status(500).json({ error: 'Failed to create tenant: ' + err.message });
  }
});

router.put('/:id', (req, res) => {
  const b = req.body;
  const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
  db.prepare(`
    UPDATE tenants SET lot_id=?, first_name=?, last_name=?, phone=?, email=?, emergency_contact=?,
      emergency_phone=?, rv_make=?, rv_model=?, rv_year=?, rv_length=?, license_plate=?,
      monthly_rent=?, rent_type=?, move_in_date=?, notes=?,
      recurring_late_fee=?, recurring_mailbox_fee=?, recurring_misc_fee=?, recurring_misc_description=?,
      recurring_credit=?, recurring_credit_description=?,
      sms_opt_in=?, email_opt_in=?, invoice_delivery=?
    WHERE id = ?
  `).run(
    str(b.lot_id), b.first_name, b.last_name, str(b.phone), str(b.email),
    str(b.emergency_contact), str(b.emergency_phone),
    str(b.rv_make), str(b.rv_model), str(b.rv_year), str(b.rv_length), str(b.license_plate),
    b.monthly_rent, b.rent_type, str(b.move_in_date), str(b.notes),
    Number(b.recurring_late_fee) || 0, Number(b.recurring_mailbox_fee) || 0,
    Number(b.recurring_misc_fee) || 0, str(b.recurring_misc_description),
    Number(b.recurring_credit) || 0, str(b.recurring_credit_description),
    b.sms_opt_in !== undefined ? (Number(b.sms_opt_in) || 0) : 1,
    b.email_opt_in !== undefined ? (Number(b.email_opt_in) || 0) : 1,
    b.invoice_delivery || 'both',
    req.params.id
  );
  res.json({ success: true });
});

// Move a tenant to a different lot in one atomic step:
//  - validate the destination is vacant (or the tenant's current lot)
//  - update tenant.lot_id
//  - mark the old lot vacant, the new lot occupied
//  - create a zero-value meter reading on the new lot so it shows up on the meters page
router.post('/:id/move', (req, res) => {
  try {
    const {
      new_lot_id,
      move_date,                   // optional, defaults to today
      old_meter_reading,           // optional: face value on old lot at moment of move
      new_meter_reading,           // optional: face value on new lot when occupied
      mid_month_move_notes,        // optional free-text
    } = req.body || {};
    if (!new_lot_id) return res.status(400).json({ error: 'new_lot_id is required' });

    const tenant = db.prepare(
      'SELECT id, lot_id, first_name, last_name, monthly_rent FROM tenants WHERE id = ? AND is_active = 1'
    ).get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (tenant.lot_id === new_lot_id) return res.status(400).json({ error: 'Tenant is already on this lot' });

    const newLot = db.prepare('SELECT id, status FROM lots WHERE id = ?').get(new_lot_id);
    if (!newLot) return res.status(404).json({ error: 'Destination lot not found' });
    if (newLot.status !== 'vacant') return res.status(400).json({ error: `Lot ${new_lot_id} is not vacant (status: ${newLot.status})` });

    const oldLotId = tenant.lot_id;
    const moveDate = move_date || new Date().toISOString().split('T')[0];

    const rateRow = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
    const rate = parseFloat(rateRow?.value || 0.15);

    // 1. Final meter reading on old lot (if provided + tenant had a lot).
    if (oldLotId && (old_meter_reading !== undefined && old_meter_reading !== null && old_meter_reading !== '')) {
      const oldFinal = Number(old_meter_reading) || 0;
      // previous reading = the most recent prior reading on the old lot for this tenant
      const prior = db.prepare(`
        SELECT current_reading FROM meter_readings
        WHERE tenant_id = ? AND lot_id = ? AND reading_date <= ?
        ORDER BY reading_date DESC, id DESC LIMIT 1
      `).get(tenant.id, oldLotId, moveDate);
      const prev = Number(prior?.current_reading) || 0;
      const kwh = Math.max(0, oldFinal - prev);
      const charge = +(kwh * rate).toFixed(2);
      db.prepare(`
        INSERT INTO meter_readings
          (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(oldLotId, tenant.id, moveDate, prev, oldFinal, kwh, rate, charge, 'Final reading at move-out');
    }

    // 2. Move the tenant + flip the lot statuses.
    db.prepare('UPDATE tenants SET lot_id = ? WHERE id = ?').run(new_lot_id, tenant.id);
    if (oldLotId) db.prepare("UPDATE lots SET status = 'vacant' WHERE id = ?").run(oldLotId);
    db.prepare("UPDATE lots SET status = 'occupied' WHERE id = ?").run(new_lot_id);

    // 3. Opening reading on the new lot.
    const opening = (new_meter_reading !== undefined && new_meter_reading !== null && new_meter_reading !== '')
      ? Number(new_meter_reading) || 0
      : 0;
    db.prepare(`
      INSERT INTO meter_readings
        (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge, notes)
      VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?)
    `).run(new_lot_id, tenant.id, moveDate, opening, opening, rate, 'Opening reading at move-in');

    // 4. Save move metadata on the tenant for proration on next invoice generation.
    db.prepare(`
      UPDATE tenants
      SET mid_month_move_notes = ?,
          last_move_date = ?,
          last_move_old_lot_id = ?,
          last_move_old_rent = ?
      WHERE id = ?
    `).run(mid_month_move_notes || null, moveDate, oldLotId, tenant.monthly_rent, tenant.id);

    res.json({
      success: true,
      tenant: `${tenant.first_name} ${tenant.last_name}`,
      from: oldLotId,
      to: new_lot_id,
      move_date: moveDate,
    });
  } catch (err) {
    console.error('[tenants] move failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/reset-pin', (req, res) => {
  db.prepare('UPDATE tenants SET portal_pin = NULL WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/:id/pause-eviction', (req, res) => {
  const { note, arrangement_type, paused_by } = req.body || {};
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`UPDATE tenants SET eviction_paused = 1, eviction_warning = 0, eviction_pause_note = ?, eviction_pause_date = ?, eviction_pause_by = ? WHERE id = ?`)
    .run(`[${arrangement_type || 'Other'}] ${note || ''}`.trim(), today, paused_by || req.user?.username || 'admin', req.params.id);
  res.json({ success: true });
});

router.post('/:id/resume-eviction', (req, res) => {
  db.prepare('UPDATE tenants SET eviction_paused = 0, eviction_pause_note = NULL, eviction_pause_date = NULL, eviction_pause_by = NULL WHERE id = ?').run(req.params.id);
  res.json({ success: true });
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
