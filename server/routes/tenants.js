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

// Never expose the bcrypt PIN hash in API responses
function stripPin(t) { if (t) delete t.portal_pin; return t; }

// Strip non-digits from phone numbers before saving (keeps SMS compatible)
function cleanPhone(v) {
  if (v === undefined || v === null || v === '') return null;
  const digits = String(v).replace(/\D/g, '');
  return digits || null;
}

router.get('/', (req, res) => {
  const tenants = db.prepare(`
    SELECT t.*, l.row_letter, l.lot_number,
      COALESCE((SELECT SUM(i.balance_due) FROM invoices i WHERE i.tenant_id = t.id AND i.status IN ('pending','partial') AND COALESCE(i.deleted,0) = 0), 0) AS balance_due,
      (SELECT COUNT(*) FROM tenant_vehicles WHERE tenant_id = t.id) AS vehicle_count,
      (SELECT COUNT(*) FROM tenant_occupants WHERE tenant_id = t.id) AS occupant_count
    FROM tenants t
    LEFT JOIN lots l ON t.lot_id = l.id
    WHERE t.is_active = 1
    ORDER BY t.lot_id
  `).all();
  res.json(tenants.map(stripPin));
});

router.get('/all', (req, res) => {
  const tenants = db.prepare(`
    SELECT t.*, l.row_letter, l.lot_number,
      COALESCE((SELECT SUM(i.balance_due) FROM invoices i WHERE i.tenant_id = t.id AND i.status IN ('pending','partial') AND COALESCE(i.deleted,0) = 0), 0) AS balance_due,
      (SELECT COUNT(*) FROM tenant_vehicles WHERE tenant_id = t.id) AS vehicle_count,
      (SELECT COUNT(*) FROM tenant_occupants WHERE tenant_id = t.id) AS occupant_count
    FROM tenants t
    LEFT JOIN lots l ON t.lot_id = l.id
    ORDER BY t.is_active DESC, t.lot_id
  `).all();
  res.json(tenants.map(stripPin));
});

// Search tenants by name, phone, email (active + inactive)
router.get('/lookup', (req, res) => {
  const q = req.query.q;
  if (!q || q.trim().length < 1) return res.json([]);
  const term = '%' + q.trim() + '%';
  try {
    const rows = db.prepare(`
      SELECT id, first_name, last_name, phone, email, lot_id, is_active, guest_rating
      FROM tenants
      WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?
         OR (first_name || ' ' || last_name) LIKE ?
      ORDER BY is_active DESC, last_name ASC
    `).all(term, term, term, term, term);
    res.json(rows);
  } catch (err) {
    console.error('[tenants] lookup failed:', err);
    res.status(500).json({ error: 'Lookup failed: ' + err.message });
  }
});

router.get('/:id', (req, res) => {
  const tenant = db.prepare(`
    SELECT t.*, l.row_letter, l.lot_number, l.id as lot_id
    FROM tenants t
    LEFT JOIN lots l ON t.lot_id = l.id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json(stripPin(tenant));
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
        emergency_contact_relationship,
        rv_make, rv_model, rv_year, rv_length, license_plate, monthly_rent, rent_type, move_in_date, notes,
        recurring_late_fee, recurring_mailbox_fee, recurring_misc_fee, recurring_misc_description,
        recurring_credit, recurring_credit_description, id_number, date_of_birth, deposit_amount,
        flat_rate, flat_rate_amount, deposit_waived, ssn_last4, dl_number, dl_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      str(b.lot_id), b.first_name, b.last_name, cleanPhone(b.phone), str(b.email),
      str(b.emergency_contact), cleanPhone(b.emergency_phone), str(b.emergency_contact_relationship),
      str(b.rv_make), str(b.rv_model), str(b.rv_year), str(b.rv_length), str(b.license_plate),
      num(b.monthly_rent) || 295, b.rent_type || 'monthly', str(b.move_in_date), str(b.notes),
      num(b.recurring_late_fee), num(b.recurring_mailbox_fee), num(b.recurring_misc_fee),
      str(b.recurring_misc_description), num(b.recurring_credit), str(b.recurring_credit_description),
      str(b.id_number), str(b.date_of_birth), num(b.deposit_amount),
      num(b.flat_rate) ? 1 : 0, num(b.flat_rate_amount), num(b.deposit_waived) ? 1 : 0,
      str(b.ssn_last4), str(b.dl_number), str(b.dl_state)
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
      emergency_phone=?, emergency_contact_relationship=?, rv_make=?, rv_model=?, rv_year=?, rv_length=?, license_plate=?,
      monthly_rent=?, rent_type=?, move_in_date=?, notes=?,
      recurring_late_fee=?, recurring_mailbox_fee=?, recurring_misc_fee=?, recurring_misc_description=?,
      recurring_credit=?, recurring_credit_description=?,
      sms_opt_in=?, email_opt_in=?, invoice_delivery=?,
      id_number=?, date_of_birth=?, deposit_amount=?, deposit_waived=?,
      flat_rate=?, flat_rate_amount=?,
      insurance_expiry=?, registration_expiry=?, loyalty_exclude=?, grace_period_override=?,
      ssn_last4=?, dl_number=?, dl_state=?
    WHERE id = ?
  `).run(
    str(b.lot_id), b.first_name, b.last_name, cleanPhone(b.phone), str(b.email),
    str(b.emergency_contact), cleanPhone(b.emergency_phone), str(b.emergency_contact_relationship),
    str(b.rv_make), str(b.rv_model), str(b.rv_year), str(b.rv_length), str(b.license_plate),
    b.monthly_rent, b.rent_type, str(b.move_in_date), str(b.notes),
    Number(b.recurring_late_fee) || 0, Number(b.recurring_mailbox_fee) || 0,
    Number(b.recurring_misc_fee) || 0, str(b.recurring_misc_description),
    Number(b.recurring_credit) || 0, str(b.recurring_credit_description),
    b.sms_opt_in !== undefined ? (Number(b.sms_opt_in) || 0) : 1,
    b.email_opt_in !== undefined ? (Number(b.email_opt_in) || 0) : 1,
    b.invoice_delivery || 'both',
    str(b.id_number), str(b.date_of_birth), Number(b.deposit_amount) || 0, b.deposit_waived ? 1 : 0,
    b.flat_rate ? 1 : 0, Number(b.flat_rate_amount) || 0,
    str(b.insurance_expiry), str(b.registration_expiry), b.loyalty_exclude ? 1 : 0, b.grace_period_override !== undefined ? (Number(b.grace_period_override) || null) : null,
    str(b.ssn_last4), str(b.dl_number), str(b.dl_state),
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
    let electricKwh = 0, electricCharge = 0;
    if (oldLotId && (old_meter_reading !== undefined && old_meter_reading !== null && old_meter_reading !== '')) {
      const oldFinal = Number(old_meter_reading) || 0;
      // previous reading = the most recent prior reading on the old lot for this tenant
      const prior = db.prepare(`
        SELECT current_reading FROM meter_readings
        WHERE tenant_id = ? AND lot_id = ? AND reading_date <= ?
        ORDER BY reading_date DESC, id DESC LIMIT 1
      `).get(tenant.id, oldLotId, moveDate);
      const prev = Number(prior?.current_reading) || 0;
      electricKwh = Math.max(0, oldFinal - prev);
      electricCharge = +(electricKwh * rate).toFixed(2);
      db.prepare(`
        INSERT INTO meter_readings
          (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(oldLotId, tenant.id, moveDate, prev, oldFinal, electricKwh, rate, electricCharge, `Final reading — lot move to ${new_lot_id}`);
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
    `).run(new_lot_id, tenant.id, moveDate, opening, opening, rate, `Opening reading — moved from ${oldLotId}`);

    // 4. Save move metadata on the tenant for proration on next invoice generation.
    const moveNotes = [
      mid_month_move_notes || '',
      electricCharge > 0 ? `Electric carry-over from ${oldLotId}: ${electricKwh} kWh = $${electricCharge.toFixed(2)}` : ''
    ].filter(Boolean).join(' — ') || null;
    db.prepare(`
      UPDATE tenants
      SET mid_month_move_notes = ?,
          last_move_date = ?,
          last_move_old_lot_id = ?,
          last_move_old_rent = ?
      WHERE id = ?
    `).run(moveNotes, moveDate, oldLotId, tenant.monthly_rent, tenant.id);

    // 5. Log the move in checkins notes for activity history.
    try {
      db.prepare(`
        UPDATE checkins SET notes = COALESCE(notes, '') || ? WHERE tenant_id = ? AND status = 'checked_in'
      `).run(`\nLOT MOVE ${moveDate}: ${oldLotId} → ${new_lot_id}${electricCharge > 0 ? ' | Electric carry-over: $' + electricCharge.toFixed(2) : ''}`, tenant.id);
    } catch (_) { /* non-critical */ }

    res.json({
      success: true,
      tenant: `${tenant.first_name} ${tenant.last_name}`,
      from: oldLotId,
      to: new_lot_id,
      move_date: moveDate,
      electric_kwh: electricKwh,
      electric_charge: electricCharge,
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

// Tenant health scores and loyalty
router.get('/scores', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var { calculateHealthScore, getScoreLabel, calculateLoyaltyDiscount } = require('./tenant-score');
  var tenants = db.prepare('SELECT id, first_name, last_name, lot_id FROM tenants WHERE is_active=1').all();
  var results = tenants.map(function(t) {
    var score = calculateHealthScore(t.id);
    var sl = getScoreLabel(score);
    var loyalty = calculateLoyaltyDiscount(t.id);
    return { id: t.id, first_name: t.first_name, last_name: t.last_name, lot_id: t.lot_id, score: score, scoreLabel: sl.label, scoreEmoji: sl.emoji, loyaltyMonths: loyalty.months, loyaltyPercent: loyalty.percent };
  });
  var avg = results.length ? Math.round(results.reduce(function(s, r) { return s + r.score; }, 0) / results.length) : 0;
  res.json({ tenants: results, averageScore: avg });
});

// CSV template download — pre-filled example rows so new parks can see the
// expected column names and value formats. Admin-only.
router.get('/import/template', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const csv =
    'Lot,Full Name,Phone,Email,Monthly Rate,Move-In Date,Lease Type,RV Make/Model,RV Length,License Plate,Date of Birth,Notes\n' +
    'A-1,John Smith,555-123-4567,john@example.com,350.00,2024-03-15,monthly,Winnebago View,25,TX ABC1234,1985-06-15,Long-term resident\n' +
    'A-2,Mary Johnson,555-987-6543,mary.j@example.com,295.00,2024-01-01,monthly,Tiffin Allegro,32,TX XYZ5678,1972-11-30,\n' +
    'B-3,Bob Davis,555-555-1212,,450.00,2024-04-01,prorated,Forest River Salem,28,,1990-03-22,Prorated first month\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tenant-import-template.csv"');
  res.send(csv);
});

// Bulk import tenants from a parsed CSV/Excel file. The client parses the file
// and sends mapped rows. Each row with a valid, existing lot will either update
// the active tenant on that lot or create a new one. Admin-only.
//
// Body: { rows: [ { lot_id, full_name, phone, email, monthly_rent,
//                   move_in_date, rent_type, rv_make_model, rv_length,
//                   license_plate, notes } ] }
router.post('/import', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'rows array is required' });

  const str = (v) => (v === undefined || v === null || v === '') ? null : String(v).trim();
  const num = (v) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const parseDate = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      let [, mm, dd, yy] = m;
      if (yy.length === 2) yy = (Number(yy) < 50 ? '20' : '19') + yy;
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return null;
  };
  const splitName = (full) => {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
  };
  const splitMakeModel = (v) => {
    const s = str(v);
    if (!s) return { make: null, model: null };
    const slash = s.split('/');
    if (slash.length > 1) return { make: slash[0].trim(), model: slash.slice(1).join('/').trim() };
    const sp = s.indexOf(' ');
    if (sp > 0) return { make: s.slice(0, sp).trim(), model: s.slice(sp + 1).trim() };
    return { make: s, model: null };
  };

  const imported = [];
  const errors = [];

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2; // account for header row + 1-based indexing
    try {
      const lot_id = str(raw.lot_id);
      const full_name = str(raw.full_name);

      if (!lot_id) {
        errors.push({ row: rowNum, lot_id: '', name: full_name || '', error: 'Missing lot number' });
        return;
      }
      if (!full_name) {
        errors.push({ row: rowNum, lot_id, name: '', error: 'Missing tenant name' });
        return;
      }

      const lot = db.prepare('SELECT id FROM lots WHERE id = ?').get(lot_id);
      if (!lot) {
        errors.push({ row: rowNum, lot_id, name: full_name, error: `Lot "${lot_id}" does not exist` });
        return;
      }

      const name = splitName(full_name);
      if (!name || !name.first) {
        errors.push({ row: rowNum, lot_id, name: full_name, error: 'Could not parse name' });
        return;
      }

      const phone = cleanPhone(raw.phone);
      const email = str(raw.email);
      const monthly_rent = num(raw.monthly_rent);
      const move_in_date = parseDate(raw.move_in_date);
      // Normalize to lowercase so values match what the rest of the app renders
      // (rent_type badges in tenants.js compare against lowercase strings).
      const rent_type = (str(raw.rent_type) || 'monthly').toLowerCase().replace(/\s+/g, '_');
      const { make: rv_make, model: rv_model } = splitMakeModel(raw.rv_make_model);
      const rv_length = str(raw.rv_length);
      const license_plate = str(raw.license_plate);
      const date_of_birth = parseDate(raw.date_of_birth);
      const notes = str(raw.notes);

      const existing = db.prepare('SELECT id FROM tenants WHERE lot_id = ? AND is_active = 1').get(lot_id);
      let tenantId;
      let action;

      if (existing) {
        // COALESCE preserves existing values when the import column is empty;
        // monthly_rent only overwrites when a positive value was supplied.
        db.prepare(`
          UPDATE tenants SET
            first_name = ?,
            last_name = ?,
            phone = COALESCE(?, phone),
            email = COALESCE(?, email),
            monthly_rent = CASE WHEN ? > 0 THEN ? ELSE monthly_rent END,
            move_in_date = COALESCE(?, move_in_date),
            rent_type = ?,
            rv_make = COALESCE(?, rv_make),
            rv_model = COALESCE(?, rv_model),
            rv_length = COALESCE(?, rv_length),
            license_plate = COALESCE(?, license_plate),
            date_of_birth = COALESCE(?, date_of_birth),
            notes = COALESCE(?, notes)
          WHERE id = ?
        `).run(
          name.first, name.last, phone, email,
          monthly_rent, monthly_rent,
          move_in_date, rent_type,
          rv_make, rv_model, rv_length, license_plate, date_of_birth, notes,
          existing.id
        );
        tenantId = existing.id;
        action = 'updated';
      } else {
        const result = db.prepare(`
          INSERT INTO tenants
            (lot_id, first_name, last_name, phone, email, rv_make, rv_model, rv_length,
             license_plate, monthly_rent, rent_type, move_in_date, date_of_birth, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          lot_id, name.first, name.last, phone, email,
          rv_make, rv_model, rv_length, license_plate,
          monthly_rent > 0 ? monthly_rent : 295,
          rent_type,
          move_in_date || new Date().toISOString().split('T')[0],
          date_of_birth, notes
        );
        tenantId = result.lastInsertRowid;
        action = 'created';
      }

      db.prepare("UPDATE lots SET status = 'occupied' WHERE id = ?").run(lot_id);
      imported.push({ row: rowNum, lot_id, tenant_id: tenantId, action, name: `${name.first} ${name.last}`.trim() });
    } catch (err) {
      errors.push({
        row: rowNum,
        lot_id: raw?.lot_id || '',
        name: raw?.full_name || '',
        error: err.message || 'Unknown error',
      });
    }
  });

  res.json({
    imported: imported.length,
    failed: errors.length,
    errors,
    details: imported,
  });
});

// Bulk flat rate operations
router.post('/bulk-flat-rate', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { action, amount, row_letter } = req.body;
  const flatAmount = Number(amount) || 0;

  if (action === 'apply_all') {
    if (!flatAmount) return res.status(400).json({ error: 'Amount is required' });
    const result = db.prepare('UPDATE tenants SET flat_rate = 1, flat_rate_amount = ? WHERE is_active = 1').run(flatAmount);
    return res.json({ success: true, updated: result.changes });
  }

  if (action === 'apply_row') {
    if (!row_letter || !flatAmount) return res.status(400).json({ error: 'Row and amount are required' });
    const result = db.prepare("UPDATE tenants SET flat_rate = 1, flat_rate_amount = ? WHERE is_active = 1 AND lot_id LIKE ?").run(flatAmount, row_letter + '%');
    return res.json({ success: true, updated: result.changes });
  }

  if (action === 'remove_all') {
    const result = db.prepare('UPDATE tenants SET flat_rate = 0, flat_rate_amount = 0 WHERE is_active = 1').run();
    return res.json({ success: true, updated: result.changes });
  }

  res.status(400).json({ error: 'Invalid action' });
});

// === GUEST LOOKUP & HISTORY ===

// Full history for a single tenant
router.get('/:id/full-history', (req, res) => {
  try {
    const tenant = stripPin(db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id));
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const checkins = db.prepare('SELECT * FROM checkins WHERE tenant_id = ? ORDER BY check_in_date DESC').all(req.params.id);
    const payments = db.prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY payment_date DESC').all(req.params.id);
    const invoices = db.prepare(`SELECT * FROM invoices WHERE tenant_id = ? AND COALESCE(deleted,0)=0 ORDER BY invoice_date DESC`).all(req.params.id);

    let notes = [];
    try { notes = db.prepare('SELECT * FROM guest_notes WHERE tenant_id = ? ORDER BY created_at DESC').all(req.params.id); } catch(e) {}
    let incidents = [];
    try { incidents = db.prepare('SELECT * FROM guest_incidents WHERE tenant_id = ? ORDER BY incident_date DESC, created_at DESC').all(req.params.id); } catch(e) {}

    res.json({ tenant, checkins, payments, invoices, notes, incidents });
  } catch (err) {
    console.error('[tenants] full-history failed:', err);
    res.status(500).json({ error: 'Failed to load history: ' + err.message });
  }
});

// Add a note
router.post('/:id/notes', (req, res) => {
  try {
    const { note_text, note_type } = req.body || {};
    if (!note_text) return res.status(400).json({ error: 'Note text is required' });
    const result = db.prepare('INSERT INTO guest_notes (tenant_id, note_text, note_type) VALUES (?, ?, ?)').run(req.params.id, note_text, note_type || 'general');
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    console.error('[tenants] add note failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Add an incident
router.post('/:id/incidents', (req, res) => {
  try {
    const { incident_date, category, description } = req.body || {};
    if (!incident_date || !category || !description) return res.status(400).json({ error: 'Date, category, and description are required' });
    const tenant = db.prepare('SELECT lot_id FROM tenants WHERE id = ?').get(req.params.id);
    const result = db.prepare('INSERT INTO guest_incidents (tenant_id, incident_date, category, description, lot_id) VALUES (?, ?, ?, ?, ?)').run(req.params.id, incident_date, category, description, tenant ? tenant.lot_id : null);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    console.error('[tenants] add incident failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// === VEHICLES ===

router.get('/:id/vehicles', (req, res) => {
  try {
    const vehicles = db.prepare('SELECT * FROM tenant_vehicles WHERE tenant_id = ? ORDER BY id').all(req.params.id);
    res.json(vehicles);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/vehicles', (req, res) => {
  try {
    const b = req.body;
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
    const result = db.prepare(
      'INSERT INTO tenant_vehicles (tenant_id, vehicle_type, make, model, color, year, license_plate, state) VALUES (?,?,?,?,?,?,?,?)'
    ).run(req.params.id, str(b.vehicle_type) || 'car', str(b.make), str(b.model), str(b.color), str(b.year), str(b.license_plate), str(b.state));
    res.json({ id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/vehicles/:vid', (req, res) => {
  try {
    const b = req.body;
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
    db.prepare(
      'UPDATE tenant_vehicles SET vehicle_type=?, make=?, model=?, color=?, year=?, license_plate=?, state=? WHERE id=? AND tenant_id=?'
    ).run(str(b.vehicle_type) || 'car', str(b.make), str(b.model), str(b.color), str(b.year), str(b.license_plate), str(b.state), req.params.vid, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/vehicles/:vid', (req, res) => {
  db.prepare('DELETE FROM tenant_vehicles WHERE id = ? AND tenant_id = ?').run(req.params.vid, req.params.id);
  res.json({ success: true });
});

// === OCCUPANTS ===

function recalcOccupancyFee(tenantId) {
  const occupants = db.prepare('SELECT age_or_dob FROM tenant_occupants WHERE tenant_id = ?').all(tenantId);
  let over8 = 0;
  for (const occ of occupants) {
    const val = occ.age_or_dob;
    if (!val) { over8++; continue; } // unknown age counts as over 8
    const age = parseInt(val);
    if (!isNaN(age)) {
      if (age > 8) over8++;
    } else {
      // Try parsing as DOB
      const dob = new Date(val);
      if (!isNaN(dob.getTime())) {
        const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (ageYears > 8) over8++;
      } else {
        over8++; // unparseable = count as over 8
      }
    }
  }
  const extraCount = Math.max(0, over8 - 2);
  const fee = extraCount * 25;
  db.prepare('UPDATE tenants SET recurring_extra_occupancy_fee = ? WHERE id = ?').run(fee, tenantId);
  return { over8, extraCount, fee };
}

router.get('/:id/occupants', (req, res) => {
  try {
    const occupants = db.prepare('SELECT * FROM tenant_occupants WHERE tenant_id = ? ORDER BY id').all(req.params.id);
    const feeInfo = recalcOccupancyFee(parseInt(req.params.id));
    res.json({ occupants, ...feeInfo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/occupants', (req, res) => {
  try {
    const b = req.body;
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
    const result = db.prepare(
      'INSERT INTO tenant_occupants (tenant_id, name, age_or_dob, relationship, ssn_last4, dl_number, dl_state) VALUES (?,?,?,?,?,?,?)'
    ).run(req.params.id, b.name, str(b.age_or_dob), str(b.relationship) || 'other', str(b.ssn_last4), str(b.dl_number), str(b.dl_state));
    const feeInfo = recalcOccupancyFee(parseInt(req.params.id));
    res.json({ id: result.lastInsertRowid, ...feeInfo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/occupants/:oid', (req, res) => {
  try {
    const b = req.body;
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
    db.prepare(
      'UPDATE tenant_occupants SET name=?, age_or_dob=?, relationship=?, ssn_last4=?, dl_number=?, dl_state=? WHERE id=? AND tenant_id=?'
    ).run(b.name, str(b.age_or_dob), str(b.relationship) || 'other', str(b.ssn_last4), str(b.dl_number), str(b.dl_state), req.params.oid, req.params.id);
    const feeInfo = recalcOccupancyFee(parseInt(req.params.id));
    res.json({ success: true, ...feeInfo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/occupants/:oid', (req, res) => {
  db.prepare('DELETE FROM tenant_occupants WHERE id = ? AND tenant_id = ?').run(req.params.oid, req.params.id);
  const feeInfo = recalcOccupancyFee(parseInt(req.params.id));
  res.json({ success: true, ...feeInfo });
});

// === AUTHORIZED PERSONS ===

router.get('/:id/authorized-persons', (req, res) => {
  try {
    const persons = db.prepare('SELECT * FROM tenant_authorized_persons WHERE tenant_id = ? ORDER BY id').all(req.params.id);
    res.json(persons);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/authorized-persons', (req, res) => {
  try {
    const b = req.body;
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
    const result = db.prepare(
      'INSERT INTO tenant_authorized_persons (tenant_id, name, phone, relationship) VALUES (?,?,?,?)'
    ).run(req.params.id, b.name, cleanPhone(b.phone), str(b.relationship) || 'other');
    res.json({ id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/authorized-persons/:pid', (req, res) => {
  try {
    const b = req.body;
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
    db.prepare(
      'UPDATE tenant_authorized_persons SET name=?, phone=?, relationship=? WHERE id=? AND tenant_id=?'
    ).run(b.name, cleanPhone(b.phone), str(b.relationship) || 'other', req.params.pid, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/authorized-persons/:pid', (req, res) => {
  db.prepare('DELETE FROM tenant_authorized_persons WHERE id = ? AND tenant_id = ?').run(req.params.pid, req.params.id);
  res.json({ success: true });
});

// Update guest rating
router.put('/:id/rating', (req, res) => {
  try {
    const { rating, reason } = req.body || {};
    if (!['green', 'yellow', 'red'].includes(rating)) return res.status(400).json({ error: 'Invalid rating' });
    if (rating === 'red' && !reason) return res.status(400).json({ error: 'Reason is required for red flag' });

    db.prepare('UPDATE tenants SET guest_rating = ? WHERE id = ?').run(rating, req.params.id);

    if (rating === 'red') {
      db.prepare('INSERT INTO guest_notes (tenant_id, note_text, note_type) VALUES (?, ?, ?)').run(req.params.id, '⚠️ FLAGGED DO NOT RE-RENT: ' + reason, 'flag');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[tenants] update rating failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
