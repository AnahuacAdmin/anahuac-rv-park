const router = require('express').Router();
const nodemailer = require('nodemailer');
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

// Lazily create a single transporter so missing env vars don't crash boot.
let _mailer = null;
function getMailer() {
  if (_mailer) return _mailer;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    throw new Error('Gmail credentials are not configured. Set GMAIL_USER and GMAIL_PASS environment variables.');
  }
  _mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
  return _mailer;
}

// Email an invoice as a PDF attachment via Gmail.
// Body: { pdfBase64: "<base64 string of the PDF generated client-side>" }
router.post('/:id/email', async (req, res) => {
  try {
    const invoice = db.prepare(`
      SELECT i.*, t.first_name, t.last_name, t.email, t.lot_id
      FROM invoices i
      JOIN tenants t ON i.tenant_id = t.id
      WHERE i.id = ?
    `).get(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoice.email) return res.status(400).json({ error: 'No email on file for this tenant' });

    const { pdfBase64 } = req.body || {};
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
      return res.status(400).json({ error: 'pdfBase64 attachment is required' });
    }

    const mailer = getMailer();
    const balance = Number(invoice.balance_due || 0).toFixed(2);
    const total = Number(invoice.total_amount || 0).toFixed(2);

    const textBody =
`Hello ${invoice.first_name},

Please find attached your invoice from Anahuac RV Park for lot ${invoice.lot_id}.

Invoice #: ${invoice.invoice_number}
Date:      ${invoice.invoice_date}
Due:       ${invoice.due_date}
Total:     $${total}
Balance:   $${balance}

Thank you for being part of our community. If you have any questions about this invoice, please reply to this email or call us at 409-267-6603.

Warm regards,
Anahuac RV Park, LLC
1003 Davis Ave, Anahuac, TX 77514
409-267-6603`;

    const htmlBody = `
      <p>Hello ${invoice.first_name},</p>
      <p>Please find attached your invoice from <strong>Anahuac RV Park</strong> for lot <strong>${invoice.lot_id}</strong>.</p>
      <table style="border-collapse:collapse">
        <tr><td><strong>Invoice #:</strong></td><td>${invoice.invoice_number}</td></tr>
        <tr><td><strong>Date:</strong></td><td>${invoice.invoice_date}</td></tr>
        <tr><td><strong>Due:</strong></td><td>${invoice.due_date}</td></tr>
        <tr><td><strong>Total:</strong></td><td>$${total}</td></tr>
        <tr><td><strong>Balance:</strong></td><td>$${balance}</td></tr>
      </table>
      <p>Thank you for being part of our community. If you have any questions about this invoice, please reply to this email or call us at 409-267-6603.</p>
      <p>Warm regards,<br>
      Anahuac RV Park, LLC<br>
      1003 Davis Ave, Anahuac, TX 77514<br>
      409-267-6603</p>
    `;

    await mailer.sendMail({
      from: `"Anahuac RV Park" <${process.env.GMAIL_USER}>`,
      to: invoice.email,
      subject: `Anahuac RV Park - Invoice ${invoice.invoice_number}`,
      text: textBody,
      html: htmlBody,
      attachments: [{
        filename: `Invoice-${invoice.invoice_number}.pdf`,
        content: Buffer.from(pdfBase64, 'base64'),
        contentType: 'application/pdf',
      }],
    });

    res.json({ success: true, sentTo: invoice.email });
  } catch (err) {
    console.error('[invoices] email failed:', err);
    res.status(500).json({ error: err.message || 'Failed to send email' });
  }
});

// Annual tax / financial summary. Aggregates per month for a given year.
// Rent / electric / fees / refunds come from the invoices table.
// Payments come from the payments table for "actually collected" totals.
router.get('/tax-report/:year', (req, res) => {
  const year = parseInt(req.params.year);
  if (!year || year < 2000 || year > 3000) return res.status(400).json({ error: 'Invalid year' });

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    const invAgg = db.prepare(`
      SELECT
        COUNT(*)                          AS invoice_count,
        COALESCE(SUM(rent_amount), 0)     AS rent,
        COALESCE(SUM(electric_amount), 0) AS electric,
        COALESCE(SUM(mailbox_fee), 0)     AS mailbox,
        COALESCE(SUM(misc_fee), 0)        AS misc,
        COALESCE(SUM(late_fee), 0)        AS late_fee,
        COALESCE(SUM(other_charges), 0)   AS other,
        COALESCE(SUM(refund_amount), 0)   AS refunds,
        COALESCE(SUM(total_amount), 0)    AS billed
      FROM invoices
      WHERE strftime('%Y-%m', invoice_date) = ?
    `).get(ym);
    const payAgg = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS collected
      FROM payments
      WHERE strftime('%Y-%m', payment_date) = ?
    `).get(ym);
    months.push({
      month: m,
      label: new Date(year, m - 1, 1).toLocaleString('default', { month: 'long' }),
      ...invAgg,
      collected: payAgg.collected,
    });
  }

  const totals = months.reduce((acc, r) => {
    for (const k of ['invoice_count','rent','electric','mailbox','misc','late_fee','other','refunds','billed','collected']) {
      acc[k] = (acc[k] || 0) + r[k];
    }
    return acc;
  }, {});

  res.json({ year, months, totals });
});

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
  try {
    const b = req.body || {};
    const tenant_id = parseInt(b.tenant_id);
    if (!tenant_id) return res.status(400).json({ error: 'Tenant is required' });
    if (!b.invoice_date) return res.status(400).json({ error: 'Invoice date is required' });
    if (!b.due_date) return res.status(400).json({ error: 'Due date is required' });

    const tenant = db.prepare('SELECT lot_id FROM tenants WHERE id = ?').get(tenant_id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // sql.js bindings reject `undefined` — coerce numbers to 0 and strings to null.
    const num = (v) => Number(v) || 0;
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);

    const rent_amount     = num(b.rent_amount);
    const electric_amount = num(b.electric_amount);
    const other_charges   = num(b.other_charges);
    const mailbox_fee     = num(b.mailbox_fee);
    const misc_fee        = num(b.misc_fee);
    const late_fee        = num(b.late_fee);
    const refund_amount   = num(b.refund_amount);

    const subtotal = rent_amount + electric_amount + other_charges + mailbox_fee + misc_fee;
    const total = subtotal + late_fee - refund_amount;
    const invoiceNum = 'INV-' + Date.now();

    const result = db.prepare(`
      INSERT INTO invoices (tenant_id, lot_id, invoice_number, invoice_date, due_date, billing_period_start, billing_period_end,
        rent_amount, electric_amount, other_charges, other_description, mailbox_fee, misc_fee, misc_description,
        refund_amount, refund_description, subtotal, late_fee, total_amount, balance_due, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      tenant_id, tenant.lot_id, invoiceNum,
      str(b.invoice_date), str(b.due_date),
      str(b.billing_period_start), str(b.billing_period_end),
      rent_amount, electric_amount, other_charges, str(b.other_description),
      mailbox_fee, misc_fee, str(b.misc_description),
      refund_amount, str(b.refund_description),
      subtotal, late_fee, total, total, str(b.notes)
    );
    res.json({ id: result.lastInsertRowid, invoice_number: invoiceNum });
  } catch (err) {
    console.error('[invoices] create failed:', err);
    res.status(500).json({ error: 'Failed to create invoice: ' + err.message });
  }
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

// Partial update — accepts any subset of editable fields and recalculates totals.
// Used by the inline cell editor on the billing page.
router.patch('/:id', (req, res) => {
  const allowed = ['rent_amount','electric_amount','other_charges','other_description',
    'late_fee','mailbox_fee','misc_fee','misc_description','refund_amount','refund_description','notes','status'];
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const merged = { ...existing };
  for (const k of allowed) {
    if (req.body[k] !== undefined) merged[k] = req.body[k];
  }
  const num = (v) => Number(v) || 0;
  const subtotal = num(merged.rent_amount) + num(merged.electric_amount) + num(merged.other_charges)
    + num(merged.mailbox_fee) + num(merged.misc_fee);
  const total = subtotal + num(merged.late_fee) - num(merged.refund_amount);
  const balance = total - num(merged.amount_paid);
  const status = req.body.status || (balance <= 0 ? 'paid' : (num(merged.amount_paid) > 0 ? 'partial' : 'pending'));

  db.prepare(`
    UPDATE invoices SET rent_amount=?, electric_amount=?, other_charges=?, other_description=?,
      mailbox_fee=?, misc_fee=?, misc_description=?, refund_amount=?, refund_description=?,
      subtotal=?, late_fee=?, total_amount=?, balance_due=?, status=?, notes=?
    WHERE id = ?
  `).run(
    num(merged.rent_amount), num(merged.electric_amount), num(merged.other_charges), merged.other_description,
    num(merged.mailbox_fee), num(merged.misc_fee), merged.misc_description,
    num(merged.refund_amount), merged.refund_description,
    subtotal, num(merged.late_fee), total, balance, status, merged.notes,
    req.params.id
  );
  res.json({
    id: Number(req.params.id),
    subtotal, total_amount: total, balance_due: balance, status,
    rent_amount: num(merged.rent_amount), electric_amount: num(merged.electric_amount),
    other_charges: num(merged.other_charges), other_description: merged.other_description,
    mailbox_fee: num(merged.mailbox_fee), misc_fee: num(merged.misc_fee), misc_description: merged.misc_description,
    refund_amount: num(merged.refund_amount), refund_description: merged.refund_description,
    late_fee: num(merged.late_fee), notes: merged.notes,
  });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(req.params.id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
