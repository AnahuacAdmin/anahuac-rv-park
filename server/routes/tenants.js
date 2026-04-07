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
