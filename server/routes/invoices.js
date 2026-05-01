/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const { Resend } = require('resend');
const { db } = require('../database');
const { authenticate, blockStaff } = require('../middleware');
const { sendSms } = require('../twilio');

router.use(authenticate);
router.use(blockStaff);

const FROM_ADDRESS = 'Anahuac RV Park <invoices@anrvpark.com>';
const REPLY_TO = 'anrvpark@gmail.com'; // Keep Gmail as reply-to so replies go to inbox
const APP_URL = process.env.APP_URL || 'https://web-production-89794.up.railway.app';

const EMAIL_FOOTER_TEXT = '\n\n—\nAnahuac RV Park, LLC\n1003 Davis Ave, Anahuac, TX 77514\n409-267-6603\n\nYou are receiving this because you are a guest at Anahuac RV Park LLC. Call 409-267-6603 to opt out of email communications.';

const EMAIL_FOOTER_HTML = `
  <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #e7e5e4;font-size:12px;color:#78716c;line-height:1.6">
    <p style="margin:0"><strong>Anahuac RV Park, LLC</strong></p>
    <p style="margin:2px 0">1003 Davis Ave, Anahuac, TX 77514</p>
    <p style="margin:2px 0">Phone: <a href="tel:4092676603" style="color:#1a5c32">409-267-6603</a> | Email: <a href="mailto:support@anrvpark.com" style="color:#1a5c32">support@anrvpark.com</a></p>
    <p style="margin:8px 0 0;font-size:11px;color:#a8a29e">You are receiving this because you are a guest at Anahuac RV Park LLC, 1003 Davis Ave, Anahuac TX 77514. Call 409-267-6603 to opt out of email communications.</p>
  </div>`;

// Sequential invoice number: finds the last INV-NNNN and increments.
function nextInvoiceNumber() {
  const lastInv = db.prepare("SELECT invoice_number FROM invoices WHERE invoice_number LIKE 'INV-%' AND invoice_number NOT LIKE 'INV-202%' ORDER BY id DESC LIMIT 1").get();
  const lastNum = lastInv ? parseInt(lastInv.invoice_number.replace('INV-', '')) || 0 : 0;
  return 'INV-' + String(lastNum + 1).padStart(4, '0');
}

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
  console.log('[EMAIL ROUTE] called at', new Date().toISOString(), 'for invoice', req.params.id, 'from IP', req.ip);
  try {
    const invoice = db.prepare(`
      SELECT i.*, t.first_name, t.last_name, t.email, t.lot_id
      FROM invoices i
      JOIN tenants t ON i.tenant_id = t.id
      WHERE i.id = ?
    `).get(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoice.email) return res.status(400).json({ error: 'No email on file for this tenant' });

    // Database-level rate limit: prevent duplicate sends within 60 seconds.
    const lastSent = db.prepare("SELECT value FROM settings WHERE key = ?").get('last_email_' + req.params.id);
    const now = Date.now();
    if (lastSent && (now - parseInt(lastSent.value)) < 60000) {
      console.log('[EMAIL ROUTE] BLOCKED duplicate within 60s for invoice', req.params.id);
      return res.status(429).json({ error: 'Email already sent for this invoice within the last 60 seconds. Please wait.' });
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('last_email_' + req.params.id, String(now));

    const { pdfBase64 } = req.body || {};
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
      return res.status(400).json({ error: 'pdfBase64 attachment is required' });
    }

    const resend = getResend();
    const balance = Number(invoice.balance_due || 0).toFixed(2);
    const total = Number(invoice.total_amount || 0).toFixed(2);

    const hasBalance = Number(balance) > 0.005;
    const balNum = Number(balance);
    const fee = +(balNum * 0.03).toFixed(2);
    const totalWithFee = +(balNum + fee).toFixed(2);

    const payLine = hasBalance
      ? `\nPay online: ${APP_URL}/pay.html?pay=${invoice.id}\nTotal with 3% convenience fee: $${totalWithFee.toFixed(2)} (fee: $${fee.toFixed(2)})\n`
      : '';

    const textBody =
`Hello ${invoice.first_name},

Please find attached your invoice from Anahuac RV Park for lot ${invoice.lot_id}.

Invoice #: ${invoice.invoice_number}
Date:      ${invoice.invoice_date}
Due:       ${invoice.due_date}
Total:     $${total}
Balance:   $${balance}
${payLine}
Thank you for being part of our community. If you have any questions about this invoice, call us at 409-267-6603.${EMAIL_FOOTER_TEXT}`;

    const payButtonHtml = hasBalance ? `
      <div style="text-align:center;margin:1.5rem 0">
        <a href="${APP_URL}/pay.html?pay=${invoice.id}" style="display:inline-block;background:#1a5c32;color:#ffffff;padding:16px 32px;border-radius:10px;text-decoration:none;margin:16px 0;line-height:1.5;text-align:center">
          <span style="font-size:18px;font-weight:bold;display:block">&#128179; PAY NOW &mdash; $${totalWithFee.toFixed(2)}</span>
          <span style="font-size:12px;font-weight:normal;opacity:0.85;display:block">(Includes 3% convenience fee of $${fee.toFixed(2)})</span>
        </a>
        <p style="font-size:12px;color:#666;margin-top:8px">This link will stop working once your payment is received.</p>
      </div>` : `
      <div style="text-align:center;margin:1rem 0;padding:12px 20px;background:#dcfce7;border-radius:8px">
        <p style="color:#166534;font-weight:bold;margin:0">&#10003; This invoice is paid in full. No action needed.</p>
      </div>`;

    const htmlBody = `
      <p>Hello ${invoice.first_name},</p>
      <p>Please find attached your invoice from <strong>Anahuac RV Park</strong> for lot <strong>${invoice.lot_id}</strong>.</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:4px 12px 4px 0"><strong>Invoice #:</strong></td><td>${invoice.invoice_number}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Due Date:</strong></td><td>${invoice.due_date}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Balance Due:</strong></td><td><strong style="color:${hasBalance ? '#dc2626' : '#16a34a'}">$${balance}</strong></td></tr>
      </table>
      ${payButtonHtml}
      <p>Thank you for being part of our community. If you have any questions about this invoice, call us at 409-267-6603.</p>
      ${EMAIL_FOOTER_HTML}
    `;

    console.log(`[invoices] emailing invoice ${invoice.invoice_number} to ${invoice.email} (PDF ${Math.round(pdfBase64.length / 1024)}KB base64)`);
    // Build a personal, non-spammy subject line
    const invoiceMonth = invoice.invoice_date ? new Date(invoice.invoice_date + 'T00:00:00').toLocaleString('en-US', { month: 'long', year: 'numeric' }) : '';
    const emailSubject = hasBalance
      ? `Hi ${invoice.first_name} — Your Anahuac RV Park Statement${invoiceMonth ? ' for ' + invoiceMonth : ''}`
      : `Anahuac RV Park — Paid Invoice ${invoice.invoice_number}`;

    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      reply_to: REPLY_TO,
      to: invoice.email,
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
      attachments: [{
        filename: `Invoice-${invoice.invoice_number}.pdf`,
        content: Buffer.from(pdfBase64, 'base64'),
      }],
      headers: {
        'X-Entity-Ref-ID': `invoice-${invoice.id}-${Date.now()}`,
        'List-Unsubscribe': `<mailto:support@anrvpark.com?subject=unsubscribe>`,
      },
    }, { idempotencyKey: `invoice-email-${invoice.id}-${Math.floor(Date.now() / 60000)}` });
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

  // Eviction processing with pause support and auto-notifications
  const mgrPhone = db.prepare("SELECT value FROM settings WHERE key = 'manager_phone'").get()?.value;
  const mgrEmail = db.prepare("SELECT value FROM settings WHERE key = 'manager_email'").get()?.value;
  const autoSms = db.prepare("SELECT value FROM settings WHERE key = 'auto_eviction_sms'").get()?.value === '1';
  const autoEmail = db.prepare("SELECT value FROM settings WHERE key = 'auto_eviction_email'").get()?.value === '1';
  let resend = null;
  try { resend = getResend(); } catch {}

  for (const tid of evictionTenantIds) {
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tid);
    if (!tenant) continue;
    if (tenant.eviction_paused) continue; // Skip paused tenants

    const wasNew = tenant.eviction_warning === 0;
    const result = db.prepare('UPDATE tenants SET eviction_warning = 1 WHERE id = ? AND eviction_warning = 0').run(tid);
    if (result.changes) evictionWarnings++;

    if (wasNew && result.changes) {
      const balance = db.prepare("SELECT COALESCE(SUM(balance_due),0) as b FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0").get(tid)?.b || 0;
      const today = new Date().toISOString().split('T')[0];
      const name = `${tenant.first_name} ${tenant.last_name}`;

      // Alert manager
      if (mgrPhone) {
        try { sendSms(mgrPhone, `EVICTION ALERT - Anahuac RV Park: ${name} Lot ${tenant.lot_id} is 5+ days overdue. Balance: $${balance.toFixed(2)}. Login: ${APP_URL}`); } catch (e) { console.error('[eviction] mgr SMS failed:', e.message); }
      }
      if (mgrEmail && resend) {
        try { resend.emails.send({ from: FROM_ADDRESS, reply_to: REPLY_TO, to: mgrEmail, subject: `Lot ${tenant.lot_id} — Past Due Alert for ${name}`, text: `Eviction warning triggered for ${name}, Lot ${tenant.lot_id}. Balance: $${balance.toFixed(2)}. Date: ${today}. Login: ${APP_URL}` }); } catch (e) { console.error('[eviction] mgr email failed:', e.message); }
      }

      // Auto-notify tenant (only once)
      if (!tenant.eviction_notified) {
        const evictionMsg = `IMPORTANT NOTICE - Anahuac RV Park: Dear ${tenant.first_name}, your account for Lot ${tenant.lot_id} is seriously past due with a balance of $${balance.toFixed(2)}. As of ${today}, the eviction process has been initiated per our rental agreement. To avoid further action, payment must be made IMMEDIATELY. Please contact park management at 409-267-6603 or log in to the tenant portal at ${APP_URL}/portal.html to pay online. We value your tenancy and hope to resolve this quickly. - Anahuac RV Park Management`;
        if (autoSms && tenant.phone) {
          try { sendSms(tenant.phone, evictionMsg); } catch (e) { console.error('[eviction] tenant SMS failed:', e.message); }
        }
        if (autoEmail && tenant.email && resend) {
          try { resend.emails.send({ from: FROM_ADDRESS, reply_to: REPLY_TO, to: tenant.email, subject: `Hi ${tenant.first_name} — Important notice about your Anahuac RV Park account`, text: evictionMsg + EMAIL_FOOTER_TEXT, html: `<p>${evictionMsg.replace(/\n/g, '<br>')}</p><div style="text-align:center;margin:1rem 0"><a href="${APP_URL}/portal.html" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:8px;font-weight:bold;text-decoration:none">LOG IN TO PAY NOW</a></div>${EMAIL_FOOTER_HTML}`, headers: { 'List-Unsubscribe': '<mailto:support@anrvpark.com?subject=unsubscribe>' } }); } catch (e) { console.error('[eviction] guest email failed:', e.message); }
        }
        db.prepare('UPDATE tenants SET eviction_notified = 1 WHERE id = ?').run(tid);
      }
    }
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
    const invoiceNum = nextInvoiceNumber();

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
    // Recalculate charge from kwh_used × rate to guard against stale/null electric_charge values.
    const periodReadings = db.prepare(`
      SELECT lot_id, kwh_used, electric_charge, rate_per_kwh
      FROM meter_readings
      WHERE tenant_id = ? AND reading_date BETWEEN ? AND ?
    `).all(tenant.id, startDate, endDate);
    let electricAmount = periodReadings.reduce((s, r) => {
      const storedCharge = Number(r.electric_charge) || 0;
      const kwh = Number(r.kwh_used) || 0;
      // Use stored charge if it looks valid, otherwise recalculate from kWh × rate
      if (storedCharge > 0) return s + storedCharge;
      if (kwh > 0) return s + +(kwh * ratePerKwh).toFixed(2);
      return s;
    }, 0);
    if (electricAmount === 0) {
      // No reading in the period yet — fall back to the most recent reading for this tenant.
      const reading = db.prepare(`
        SELECT kwh_used, electric_charge FROM meter_readings WHERE tenant_id = ? ORDER BY reading_date DESC LIMIT 1
      `).get(tenant.id);
      if (reading) {
        const fallbackCharge = Number(reading.electric_charge) || 0;
        const fallbackKwh = Number(reading.kwh_used) || 0;
        electricAmount = fallbackCharge > 0 ? fallbackCharge : +(fallbackKwh * ratePerKwh).toFixed(2);
      }
    }

    // Mid-month move proration: if last_move_date falls inside this period,
    // split the rent between the old and new lot by days.
    let rentAmount = tenant.monthly_rent;

    // Flat rate billing: one amount covers everything, skip electric
    if (tenant.flat_rate && tenant.flat_rate_amount > 0) {
      const invoiceNum = nextInvoiceNumber();
      const flatAmount = Number(tenant.flat_rate_amount);
      const tenantCredit = Number(tenant.credit_balance) || 0;
      let creditApplied = 0;
      if (tenantCredit > 0 && flatAmount > 0) {
        creditApplied = +Math.min(tenantCredit, flatAmount).toFixed(2);
        db.prepare('UPDATE tenants SET credit_balance = credit_balance - ? WHERE id = ?').run(creditApplied, tenant.id);
      }
      const total = +(flatAmount - creditApplied).toFixed(2);
      const flatInvResult = db.prepare(`
        INSERT INTO invoices (tenant_id, lot_id, invoice_number, invoice_date, due_date, billing_period_start, billing_period_end,
          rent_amount, electric_amount, subtotal, total_amount, balance_due, status, notes, credit_applied)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', ?, ?)
      `).run(tenant.id, tenant.lot_id, invoiceNum, startDate, dueDate, startDate, endDate,
        flatAmount, flatAmount, total, total, 'Flat rate — all-inclusive', creditApplied);
      if (creditApplied > 0) {
        db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, invoice_id, notes)
          VALUES (?, 'applied_to_invoice', ?, ?, ?)`).run(tenant.id, -creditApplied, flatInvResult.lastInsertRowid,
          `$${creditApplied.toFixed(2)} credit applied to ${invoiceNum} (flat rate)`);
      }
      generated.push(tenant.lot_id);
      continue; // skip the normal calculation below
    }

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
    const extraOccupancy = tenant.recurring_extra_occupancy_fee || 0;
    const subtotal = rentAmount + electricAmount + mailbox + misc + extraOccupancy;
    const totalBeforeCredit = subtotal + lateFee - credit;
    const invoiceNum = nextInvoiceNumber();
    const combinedNotes = [moveNote, tenant.mid_month_move_notes].filter(Boolean).join(' — ') || null;

    // Apply tenant credit balance to reduce the invoice.
    const tenantCredit = Number(tenant.credit_balance) || 0;
    let creditApplied = 0;
    if (tenantCredit > 0 && totalBeforeCredit > 0) {
      creditApplied = +Math.min(tenantCredit, totalBeforeCredit).toFixed(2);
      db.prepare('UPDATE tenants SET credit_balance = credit_balance - ? WHERE id = ?').run(creditApplied, tenant.id);
    }
    const total = +(totalBeforeCredit - creditApplied).toFixed(2);

    const stdInvResult = db.prepare(`
      INSERT INTO invoices (tenant_id, lot_id, invoice_number, invoice_date, due_date, billing_period_start, billing_period_end,
        rent_amount, electric_amount, mailbox_fee, misc_fee, misc_description, extra_occupancy_fee,
        refund_amount, refund_description, late_fee, subtotal, total_amount, balance_due, status, notes, credit_applied)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(tenant.id, tenant.lot_id, invoiceNum, startDate, dueDate, startDate, endDate,
      rentAmount, electricAmount, mailbox, misc, tenant.recurring_misc_description, extraOccupancy,
      credit, tenant.recurring_credit_description, lateFee, subtotal, total, total, combinedNotes, creditApplied);
    if (creditApplied > 0) {
      db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, invoice_id, notes)
        VALUES (?, 'applied_to_invoice', ?, ?, ?)`).run(tenant.id, -creditApplied, stdInvResult.lastInsertRowid,
        `$${creditApplied.toFixed(2)} credit applied to ${invoiceNum}`);
    }
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
