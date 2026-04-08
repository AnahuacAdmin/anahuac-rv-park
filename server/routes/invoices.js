const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const invoices = db.prepare(`
    SELECT i.*, t.first_name, t.last_name, t.lot_id
    FROM invoices i
    JOIN tenants t ON i.tenant_id = t.id
    ORDER BY i.invoice_date DESC
  `).all();
  res.json(invoices);
});

router.get('/:id', (req, res) => {
  const invoice = db.prepare(`
    SELECT i.*, t.first_name, t.last_name, t.lot_id, t.phone, t.email
    FROM invoices i
    JOIN tenants t ON i.tenant_id = t.id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC').all(req.params.id);

  // Find the meter reading for this invoice. Try by billing period first, then
  // fall back to the most recent reading on or before the period end, then to the
  // latest reading for the lot. This way the line items show up even if a reading
  // was entered a day outside the period or the period dates are missing.
  let meter = null;
  if (invoice.billing_period_start && invoice.billing_period_end) {
    meter = db.prepare(
      `SELECT previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge, reading_date
       FROM meter_readings
       WHERE lot_id = ? AND reading_date BETWEEN ? AND ?
       ORDER BY reading_date DESC LIMIT 1`
    ).get(invoice.lot_id, invoice.billing_period_start, invoice.billing_period_end);
  }
  if (!meter && invoice.billing_period_end) {
    meter = db.prepare(
      `SELECT previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge, reading_date
       FROM meter_readings
       WHERE lot_id = ? AND reading_date <= ?
       ORDER BY reading_date DESC LIMIT 1`
    ).get(invoice.lot_id, invoice.billing_period_end);
  }
  if (!meter) {
    meter = db.prepare(
      `SELECT previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge, reading_date
       FROM meter_readings
       WHERE lot_id = ?
       ORDER BY reading_date DESC LIMIT 1`
    ).get(invoice.lot_id);
  }

  res.json({ ...invoice, payments, meter });
});

router.post('/', (req, res) => {
  const { tenant_id, invoice_date, due_date, billing_period_start, billing_period_end,
    rent_amount, electric_amount, other_charges, other_description, late_fee,
    mailbox_fee, misc_fee, misc_description, refund_amount, refund_description, notes } = req.body;

  const subtotal = (rent_amount || 0) + (electric_amount || 0) + (other_charges || 0)
    + (mailbox_fee || 0) + (misc_fee || 0);
  const total = subtotal + (late_fee || 0) - (refund_amount || 0);
  const invoiceNum = 'INV-' + Date.now();

  const tenant = db.prepare('SELECT lot_id FROM tenants WHERE id = ?').get(tenant_id);

  const result = db.prepare(`
    INSERT INTO invoices (tenant_id, lot_id, invoice_number, invoice_date, due_date, billing_period_start, billing_period_end,
      rent_amount, electric_amount, other_charges, other_description, mailbox_fee, misc_fee, misc_description,
      refund_amount, refund_description, subtotal, late_fee, total_amount, balance_due, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(tenant_id, tenant?.lot_id, invoiceNum, invoice_date, due_date, billing_period_start, billing_period_end,
    rent_amount || 0, electric_amount || 0, other_charges || 0, other_description,
    mailbox_fee || 0, misc_fee || 0, misc_description, refund_amount || 0, refund_description,
    subtotal, late_fee || 0, total, total, notes);
  res.json({ id: result.lastInsertRowid, invoice_number: invoiceNum });
});

router.post('/generate', (req, res) => {
  const { billing_month, billing_year } = req.body;
  const tenants = db.prepare('SELECT * FROM tenants WHERE is_active = 1').all();
  const rate = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
  const ratePerKwh = parseFloat(rate?.value || 0.15);
  const generated = [];

  const startDate = `${billing_year}-${String(billing_month).padStart(2, '0')}-01`;
  const dueDate = `${billing_year}-${String(billing_month).padStart(2, '0')}-01`;
  const endDay = new Date(billing_year, billing_month, 0).getDate();
  const endDate = `${billing_year}-${String(billing_month).padStart(2, '0')}-${endDay}`;

  for (const tenant of tenants) {
    const existing = db.prepare(
      'SELECT id FROM invoices WHERE tenant_id = ? AND billing_period_start = ?'
    ).get(tenant.id, startDate);
    if (existing) continue;

    const reading = db.prepare(`
      SELECT * FROM meter_readings WHERE tenant_id = ? ORDER BY reading_date DESC LIMIT 1
    `).get(tenant.id);

    const electricAmount = reading ? reading.electric_charge : 0;
    const mailbox = tenant.recurring_mailbox_fee || 0;
    const misc = tenant.recurring_misc_fee || 0;
    const lateFee = tenant.recurring_late_fee || 0;
    const credit = tenant.recurring_credit || 0;
    const subtotal = tenant.monthly_rent + electricAmount + mailbox + misc;
    const total = subtotal + lateFee - credit;
    const invoiceNum = `INV-${billing_year}${String(billing_month).padStart(2, '0')}-${tenant.lot_id}`;

    db.prepare(`
      INSERT INTO invoices (tenant_id, lot_id, invoice_number, invoice_date, due_date, billing_period_start, billing_period_end,
        rent_amount, electric_amount, mailbox_fee, misc_fee, misc_description,
        refund_amount, refund_description, late_fee, subtotal, total_amount, balance_due, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(tenant.id, tenant.lot_id, invoiceNum, startDate, dueDate, startDate, endDate,
      tenant.monthly_rent, electricAmount, mailbox, misc, tenant.recurring_misc_description,
      credit, tenant.recurring_credit_description, lateFee, subtotal, total, total);
    generated.push(tenant.lot_id);
  }

  res.json({ generated: generated.length, lots: generated });
});

router.put('/:id', (req, res) => {
  const { rent_amount, electric_amount, other_charges, other_description, late_fee,
    mailbox_fee, misc_fee, misc_description, refund_amount, refund_description, status, notes } = req.body;
  const subtotal = (rent_amount || 0) + (electric_amount || 0) + (other_charges || 0)
    + (mailbox_fee || 0) + (misc_fee || 0);
  const total = subtotal + (late_fee || 0) - (refund_amount || 0);

  const existing = db.prepare('SELECT amount_paid FROM invoices WHERE id = ?').get(req.params.id);
  const balance = total - (existing?.amount_paid || 0);

  db.prepare(`
    UPDATE invoices SET rent_amount=?, electric_amount=?, other_charges=?, other_description=?,
      mailbox_fee=?, misc_fee=?, misc_description=?, refund_amount=?, refund_description=?,
      subtotal=?, late_fee=?, total_amount=?, balance_due=?, status=?, notes=?
    WHERE id = ?
  `).run(rent_amount || 0, electric_amount || 0, other_charges || 0, other_description,
    mailbox_fee || 0, misc_fee || 0, misc_description, refund_amount || 0, refund_description,
    subtotal, late_fee || 0, total, balance, status || (balance <= 0 ? 'paid' : 'pending'), notes, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(req.params.id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
