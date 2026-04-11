const router = require('express').Router();
const { Resend } = require('resend');
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

router.use(authenticate);

const FROM_ADDRESS = 'Anahuac RV Park <invoices@anrvpark.com>';
const APP_URL = process.env.APP_URL || 'https://web-production-89794.up.railway.app';

// Lazily create a single Resend client so a missing key doesn't crash boot.
let _resend = null;
function getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Resend is not configured. Set RESEND_API_KEY environment variable.');
  }
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
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

    const resend = getResend();
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

You can pay your invoice online at: ${APP_URL}/?pay=${invoice.id}
Note: A 3% convenience fee applies to card payments.

Thank you for being part of our community. If you have any questions about this invoice, call us at 409-267-6603.

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
      <div style="text-align:center;margin:1.5rem 0">
        <a href="${APP_URL}/?pay=${invoice.id}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:bold;text-decoration:none;margin:16px 0">Pay Invoice Online - $${balance}</a>
        <p style="font-size:12px;color:#666;margin-top:8px">A 3% convenience fee applies to credit/debit card payments.</p>
      </div>
      <p>Thank you for being part of our community. If you have any questions about this invoice, call us at 409-267-6603.</p>
      <p>Warm regards,<br>
      Anahuac RV Park, LLC<br>
      1003 Davis Ave, Anahuac, TX 77514<br>
      409-267-6603</p>
    `;

    console.log(`[invoices] emailing invoice ${invoice.invoice_number} to ${invoice.email} (PDF ${Math.round(pdfBase64.length / 1024)}KB base64)`);
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      reply_to: 'anrvpark@gmail.com',
      to: invoice.email,
      subject: `Anahuac RV Park - Invoice ${invoice.invoice_number}`,
      text: textBody,
      html: htmlBody,
      attachments: [{
        filename: `Invoice-${invoice.invoice_number}.pdf`,
        content: Buffer.from(pdfBase64, 'base64'),
      }],
    });
    if (error) {
      console.error('[invoices] resend returned error:', error);
      return res.status(502).json({ error: error.message || 'Resend rejected the email' });
    }

    res.json({ success: true, sentTo: invoice.email, id: data?.id });
  } catch (err) {
    console.error('[invoices] email failed:', err);
    res.status(500).json({ error: err.message || 'Failed to send email' });
  }
});

// --- Late fee automation ----------------------------------------------------
// Rules:
//  - If invoice is unpaid/partial AND >= 3 days old AND late_fee_auto_applied = 0
//    → add $25 late fee, mark late_fee_auto_applied = 1, recalc total + balance.
//  - If invoice is unpaid/partial AND >= 5 days old → set tenant.eviction_warning = 1.
//  - Never apply the auto fee twice (the late_fee_auto_applied flag enforces this).
function runLateFeeCheck() {
  const LATE_FEE = 25;
  const today = new Date().toISOString().split('T')[0];

  const candidates = db.prepare(`
    SELECT id, tenant_id, invoice_date, late_fee, total_amount, balance_due, amount_paid,
           late_fee_auto_applied, status,
           CAST(julianday(?) - julianday(invoice_date) AS INTEGER) AS age_days
    FROM invoices
    WHERE status IN ('pending', 'partial') AND balance_due > 0.005 AND COALESCE(deleted, 0) = 0
  `).all(today);

  let feesApplied = 0;
  let evictionWarnings = 0;
  const evictionTenantIds = new Set();
  const feeInvoiceNumbers = [];

  for (const inv of candidates) {
    const age = inv.age_days || 0;

    // 3-day rule: apply auto late fee once
    if (age >= 3 && !inv.late_fee_auto_applied) {
      const newLateFee  = (Number(inv.late_fee) || 0) + LATE_FEE;
      const newTotal    = (Number(inv.total_amount) || 0) + LATE_FEE;
      const newBalance  = (Number(inv.balance_due)  || 0) + LATE_FEE;
      db.prepare(`
        UPDATE invoices
        SET late_fee = ?, total_amount = ?, balance_due = ?, late_fee_auto_applied = 1
        WHERE id = ?
      `).run(newLateFee, newTotal, newBalance, inv.id);
      feesApplied++;
      const inum = db.prepare('SELECT invoice_number FROM invoices WHERE id = ?').get(inv.id);
      if (inum) feeInvoiceNumbers.push(inum.invoice_number);
    }

    // 5-day rule: flag eviction warning on the tenant
    if (age >= 5) {
      evictionTenantIds.add(inv.tenant_id);
    }
  }

  for (const tid of evictionTenantIds) {
    const result = db.prepare('UPDATE tenants SET eviction_warning = 1 WHERE id = ? AND eviction_warning = 0').run(tid);
    if (result.changes) evictionWarnings++;
  }

  return {
    checkedAt: new Date().toISOString(),
    invoicesChecked: candidates.length,
    feesApplied,
    feeAmountTotal: feesApplied * LATE_FEE,
    evictionWarnings,
    feeInvoiceNumbers,
  };
}

router.post('/check-late-fees', (req, res) => {
  try {
    const summary = runLateFeeCheck();
    res.json(summary);
  } catch (err) {
    console.error('[invoices] late fee check failed:', err);
    res.status(500).json({ error: err.message });
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
      WHERE strftime('%Y-%m', invoice_date) = ? AND COALESCE(deleted, 0) = 0
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
  const includeDeleted = req.query.includeDeleted === '1' || req.query.includeDeleted === 'true';
  const invoices = db.prepare(`
    SELECT i.*, t.first_name, t.last_name, t.lot_id
    FROM invoices i
    JOIN tenants t ON i.tenant_id = t.id
    ${includeDeleted ? '' : 'WHERE COALESCE(i.deleted, 0) = 0'}
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

  // All meter readings for THIS tenant within the billing period — used to render
  // multiple electric line items when the tenant moved mid-month.
  let meters = [];
  if (invoice.billing_period_start && invoice.billing_period_end) {
    meters = db.prepare(`
      SELECT lot_id, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge, reading_date, notes
      FROM meter_readings
      WHERE tenant_id = ? AND reading_date BETWEEN ? AND ?
      ORDER BY reading_date ASC, id ASC
    `).all(invoice.tenant_id, invoice.billing_period_start, invoice.billing_period_end);
  }

  res.json({ ...invoice, payments, meter, meters });
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
    const count = db.prepare('SELECT COUNT(*) as c FROM invoices').get().c + 1;
    const invoiceNum = 'INV-' + String(count).padStart(4, '0');

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
      'SELECT id FROM invoices WHERE tenant_id = ? AND billing_period_start = ? AND COALESCE(deleted, 0) = 0'
    ).get(tenant.id, startDate);
    if (existing) continue;

    // Sum ALL of this tenant's meter readings inside the billing period — when
    // they moved mid-month there will be one row for the old lot (final) and
    // one for the new lot (opening, $0).
    const periodReadings = db.prepare(`
      SELECT lot_id, kwh_used, electric_charge
      FROM meter_readings
      WHERE tenant_id = ? AND reading_date BETWEEN ? AND ?
    `).all(tenant.id, startDate, endDate);
    let electricAmount = periodReadings.reduce((s, r) => s + (Number(r.electric_charge) || 0), 0);
    if (electricAmount === 0) {
      // No reading in the period yet — fall back to the most recent reading for this tenant.
      const reading = db.prepare(`
        SELECT electric_charge FROM meter_readings WHERE tenant_id = ? ORDER BY reading_date DESC LIMIT 1
      `).get(tenant.id);
      electricAmount = reading?.electric_charge || 0;
    }

    // Mid-month move proration: if last_move_date falls inside this period,
    // split the rent between the old and new lot by days.
    let rentAmount = tenant.monthly_rent;
    let moveNote = '';
    if (tenant.last_move_date && tenant.last_move_date >= startDate && tenant.last_move_date <= endDate) {
      const daysInMonth = new Date(billing_year, billing_month, 0).getDate();
      const moveDay = parseInt(tenant.last_move_date.slice(8, 10));
      const daysOld = Math.max(0, moveDay - 1);
      const daysNew = daysInMonth - daysOld;
      const oldRent = Number(tenant.last_move_old_rent) || tenant.monthly_rent;
      rentAmount = +((oldRent * daysOld / daysInMonth) + (tenant.monthly_rent * daysNew / daysInMonth)).toFixed(2);
      moveNote = `Mid-month move on ${tenant.last_move_date}: ${daysOld} days @ $${oldRent.toFixed(2)} (${tenant.last_move_old_lot_id}) + ${daysNew} days @ $${Number(tenant.monthly_rent).toFixed(2)} (${tenant.lot_id})`;
      // Clear the move flag so subsequent generations don't double-prorate.
      db.prepare('UPDATE tenants SET last_move_date = NULL, last_move_old_lot_id = NULL, last_move_old_rent = NULL WHERE id = ?').run(tenant.id);
    }

    const mailbox = tenant.recurring_mailbox_fee || 0;
    const misc = tenant.recurring_misc_fee || 0;
    const lateFee = tenant.recurring_late_fee || 0;
    const credit = tenant.recurring_credit || 0;
    const subtotal = rentAmount + electricAmount + mailbox + misc;
    const total = subtotal + lateFee - credit;
    const genCount = db.prepare('SELECT COUNT(*) as c FROM invoices').get().c + 1;
    const invoiceNum = 'INV-' + String(genCount).padStart(4, '0');
    const combinedNotes = [moveNote, tenant.mid_month_move_notes].filter(Boolean).join(' — ') || null;

    db.prepare(`
      INSERT INTO invoices (tenant_id, lot_id, invoice_number, invoice_date, due_date, billing_period_start, billing_period_end,
        rent_amount, electric_amount, mailbox_fee, misc_fee, misc_description,
        refund_amount, refund_description, late_fee, subtotal, total_amount, balance_due, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(tenant.id, tenant.lot_id, invoiceNum, startDate, dueDate, startDate, endDate,
      rentAmount, electricAmount, mailbox, misc, tenant.recurring_misc_description,
      credit, tenant.recurring_credit_description, lateFee, subtotal, total, total, combinedNotes);
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

// Soft delete — flag the invoice as deleted instead of removing the row.
// Payments are NOT touched so the audit trail is preserved.
// Send a single invoice summary as an SMS to the tenant.
router.post('/:id/sms', async (req, res) => {
  try {
    console.log(`[sms] invoice SMS requested for id=${req.params.id}`);
    const inv = db.prepare(`
      SELECT i.*, t.first_name, t.phone FROM invoices i
      JOIN tenants t ON i.tenant_id = t.id
      WHERE i.id = ? AND COALESCE(i.deleted, 0) = 0
    `).get(req.params.id);
    if (!inv) { console.log('[sms] invoice not found'); return res.status(404).json({ error: 'Invoice not found' }); }
    if (!inv.phone) { console.log('[sms] no phone on file'); return res.status(400).json({ error: 'No phone on file for this tenant' }); }
    console.log(`[sms] sending to ${inv.phone} for invoice ${inv.invoice_number}`);
    const body = `Anahuac RV Park: Hi ${inv.first_name}, your invoice ${inv.invoice_number} is $${Number(inv.total_amount).toFixed(2)}, balance due $${Number(inv.balance_due).toFixed(2)}, due ${inv.due_date}. Questions? 409-267-6603`;
    const r = await sendSms(inv.phone, body);
    console.log(`[sms] sent successfully, sid=${r.sid}`);
    res.json({ success: true, sid: r.sid, sentTo: r.to });
  } catch (err) {
    console.error('[sms] invoice SMS failed:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// Text every tenant who currently has an unpaid balance.
router.post('/sms-unpaid', async (req, res) => {
  try {
    const tenants = db.prepare(`
      SELECT t.id, t.first_name, t.phone, COALESCE(SUM(i.balance_due), 0) AS balance
      FROM tenants t
      JOIN invoices i ON i.tenant_id = t.id
      WHERE t.is_active = 1
        AND COALESCE(i.deleted, 0) = 0
        AND i.balance_due > 0.005
        AND i.status IN ('pending','partial')
      GROUP BY t.id
      HAVING balance > 0.005
    `).all();
    let sent = 0, failed = 0, skipped = 0;
    const errors = [];
    for (const t of tenants) {
      if (!t.phone) { skipped++; continue; }
      const body = `Anahuac RV Park: Hi ${t.first_name}, friendly reminder — your account has an outstanding balance of $${Number(t.balance).toFixed(2)}. Please contact us at 409-267-6603 to arrange payment. Thank you!`;
      try { await sendSms(t.phone, body); sent++; }
      catch (e) { failed++; errors.push(`tenant ${t.id}: ${e.message}`); }
    }
    res.json({ totalUnpaid: tenants.length, sent, failed, skipped, errors });
  } catch (err) {
    console.error('[invoices] sms-unpaid failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  db.prepare('UPDATE invoices SET deleted = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true, soft: true });
});

router.post('/:id/restore', (req, res) => {
  const existing = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  db.prepare('UPDATE invoices SET deleted = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
// Expose the late-fee runner so the daily scheduler in server/index.js can call it directly.
module.exports.runLateFeeCheck = runLateFeeCheck;
