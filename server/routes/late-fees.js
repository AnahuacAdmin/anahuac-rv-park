/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const crypto = require('crypto');
const { Resend } = require('resend');
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

const APP_URL = process.env.APP_URL || 'https://web-production-89794.up.railway.app';
const FROM_ADDRESS = 'Anahuac RV Park <invoices@anrvpark.com>';
const REPLY_TO = 'anrvpark@gmail.com';

let _resend = null;
function getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) throw new Error('Resend not configured');
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

function getLateFeeSettings() {
  return {
    amount: parseFloat(getSetting('late_fee_amount')) || 25,
    type: getSetting('late_fee_type') || 'fixed',
    percentage: parseFloat(getSetting('late_fee_percentage')) || 10,
    graceDays: parseInt(getSetting('late_fee_grace_days')) || 3,
    mode: getSetting('late_fee_mode') || 'notify',
    email: getSetting('late_fee_email') || 'anrvpark@gmail.com',
    smsNumber: getSetting('late_fee_sms_number') || '',
    emailEnabled: getSetting('late_fee_email_enabled') === '1',
    smsEnabled: getSetting('late_fee_sms_enabled') === '1',
  };
}

function calculateLateFee(settings, rentAmount) {
  if (settings.type === 'percentage') {
    return Math.round((rentAmount * settings.percentage / 100) * 100) / 100;
  }
  return settings.amount;
}

// ============================================
// PUBLIC ROUTES — Token-based Apply/Waive from email
// ============================================

router.get('/apply', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send(renderPage('Invalid Link', 'No token provided.'));

  const row = db.prepare('SELECT * FROM late_fee_tokens WHERE token = ? AND action = ?').get(token, 'apply');
  if (!row) return res.status(404).send(renderPage('Link Not Found', 'This link is invalid or has expired. Please manage late fees from the admin dashboard.'));
  if (row.used_at) return res.status(410).send(renderPage('Already Used', 'This action was already taken. Please manage late fees from the admin dashboard.'));
  if (new Date(row.expires_at) < new Date()) return res.status(410).send(renderPage('Link Expired', 'This link has expired. Please manage late fees from the admin dashboard.'));

  const inv = db.prepare('SELECT i.*, t.first_name, t.last_name, t.lot_id FROM invoices i JOIN tenants t ON i.tenant_id = t.id WHERE i.id = ?').get(row.invoice_id);
  if (!inv) return res.status(404).send(renderPage('Invoice Not Found', 'The invoice associated with this link no longer exists.'));

  const settings = getLateFeeSettings();
  const feeAmount = calculateLateFee(settings, Number(inv.rent_amount) || 0);

  // Apply the late fee
  const newLateFee = (Number(inv.late_fee) || 0) + feeAmount;
  const newTotal = (Number(inv.total_amount) || 0) + feeAmount;
  const newBalance = (Number(inv.balance_due) || 0) + feeAmount;
  db.prepare('UPDATE invoices SET late_fee = ?, total_amount = ?, balance_due = ?, late_fee_auto_applied = 1 WHERE id = ?')
    .run(newLateFee, newTotal, newBalance, row.invoice_id);

  // Mark token used
  db.prepare('UPDATE late_fee_tokens SET used_at = datetime(?) WHERE id = ?').run(new Date().toISOString(), row.id);

  // Log it
  db.prepare('INSERT INTO late_fee_log (invoice_id, tenant_id, action, amount, reason, admin_user) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.invoice_id, inv.tenant_id, 'applied', feeAmount, 'Applied via email link', 'email-link');

  res.send(renderPage('Late Fee Applied',
    `<div style="color:#16a34a;font-size:1.2rem;font-weight:700;margin-bottom:0.5rem">✅ Late fee applied successfully</div>
     <p><strong>$${feeAmount.toFixed(2)}</strong> late fee added to <strong>${inv.first_name} ${inv.last_name}</strong>'s invoice <strong>${inv.invoice_number}</strong> (Lot ${inv.lot_id})</p>
     <p style="margin-top:1rem"><a href="${APP_URL}" style="color:#1a5c32;font-weight:600">Go to Admin Dashboard →</a></p>`));
});

router.get('/waive', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send(renderPage('Invalid Link', 'No token provided.'));

  const row = db.prepare('SELECT * FROM late_fee_tokens WHERE token = ? AND action = ?').get(token, 'waive');
  if (!row) return res.status(404).send(renderPage('Link Not Found', 'This link is invalid or has expired. Please manage late fees from the admin dashboard.'));
  if (row.used_at) return res.status(410).send(renderPage('Already Used', 'This action was already taken. Please manage late fees from the admin dashboard.'));
  if (new Date(row.expires_at) < new Date()) return res.status(410).send(renderPage('Link Expired', 'This link has expired. Please manage late fees from the admin dashboard.'));

  const inv = db.prepare('SELECT i.*, t.first_name, t.last_name, t.lot_id FROM invoices i JOIN tenants t ON i.tenant_id = t.id WHERE i.id = ?').get(row.invoice_id);
  if (!inv) return res.status(404).send(renderPage('Invoice Not Found', 'The invoice associated with this link no longer exists.'));

  // Mark as waived
  db.prepare('UPDATE invoices SET late_fee_waived = 1, late_fee_waived_reason = ? WHERE id = ?')
    .run('Waived via email link', row.invoice_id);

  // Mark token used
  db.prepare('UPDATE late_fee_tokens SET used_at = datetime(?) WHERE id = ?').run(new Date().toISOString(), row.id);

  // Log it
  db.prepare('INSERT INTO late_fee_log (invoice_id, tenant_id, action, amount, reason, admin_user) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.invoice_id, inv.tenant_id, 'waived', 0, 'Waived via email link', 'email-link');

  res.send(renderPage('Late Fee Waived',
    `<div style="color:#f59e0b;font-size:1.2rem;font-weight:700;margin-bottom:0.5rem">✅ Late fee waived</div>
     <p>Late fee waived for <strong>${inv.first_name} ${inv.last_name}</strong>'s invoice <strong>${inv.invoice_number}</strong> (Lot ${inv.lot_id})</p>
     <p style="margin-top:1rem"><a href="${APP_URL}" style="color:#1a5c32;font-weight:600">Go to Admin Dashboard →</a></p>`));
});

// ============================================
// ADMIN ROUTES — Authenticated
// ============================================

router.post('/admin/apply', authenticate, (req, res) => {
  const { invoice_id, amount } = req.body;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });

  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  const settings = getLateFeeSettings();
  const feeAmount = amount || calculateLateFee(settings, Number(inv.rent_amount) || 0);

  const newLateFee = (Number(inv.late_fee) || 0) + feeAmount;
  const newTotal = (Number(inv.total_amount) || 0) + feeAmount;
  const newBalance = (Number(inv.balance_due) || 0) + feeAmount;
  db.prepare('UPDATE invoices SET late_fee = ?, total_amount = ?, balance_due = ?, late_fee_auto_applied = 1 WHERE id = ?')
    .run(newLateFee, newTotal, newBalance, invoice_id);

  db.prepare('INSERT INTO late_fee_log (invoice_id, tenant_id, action, amount, reason, admin_user) VALUES (?, ?, ?, ?, ?, ?)')
    .run(invoice_id, inv.tenant_id, 'applied', feeAmount, 'Applied by admin', req.user?.username || 'admin');

  res.json({ success: true, amount: feeAmount, newBalance });
});

router.post('/admin/waive', authenticate, (req, res) => {
  const { invoice_id, reason } = req.body;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });

  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  db.prepare('UPDATE invoices SET late_fee_waived = 1, late_fee_waived_reason = ? WHERE id = ?')
    .run(reason || 'Waived by admin', invoice_id);

  db.prepare('INSERT INTO late_fee_log (invoice_id, tenant_id, action, amount, reason, admin_user) VALUES (?, ?, ?, ?, ?, ?)')
    .run(invoice_id, inv.tenant_id, 'waived', 0, reason || 'Waived by admin', req.user?.username || 'admin');

  res.json({ success: true });
});

router.post('/admin/remove', authenticate, (req, res) => {
  const { invoice_id } = req.body;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });

  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  const lateFee = Number(inv.late_fee) || 0;
  if (lateFee <= 0) return res.status(400).json({ error: 'No late fee to remove' });

  const newTotal = (Number(inv.total_amount) || 0) - lateFee;
  const newBalance = (Number(inv.balance_due) || 0) - lateFee;
  db.prepare('UPDATE invoices SET late_fee = 0, total_amount = ?, balance_due = ?, late_fee_auto_applied = 0 WHERE id = ?')
    .run(Math.max(0, newTotal), Math.max(0, newBalance), invoice_id);

  db.prepare('INSERT INTO late_fee_log (invoice_id, tenant_id, action, amount, reason, admin_user) VALUES (?, ?, ?, ?, ?, ?)')
    .run(invoice_id, inv.tenant_id, 'removed', lateFee, 'Removed by admin', req.user?.username || 'admin');

  res.json({ success: true, removedAmount: lateFee });
});

router.get('/admin/log', authenticate, (req, res) => {
  const { tenant_id } = req.query;
  let sql = `SELECT l.*, i.invoice_number, t.first_name, t.last_name, t.lot_id
    FROM late_fee_log l
    LEFT JOIN invoices i ON l.invoice_id = i.id
    LEFT JOIN tenants t ON l.tenant_id = t.id`;
  const params = [];
  if (tenant_id) { sql += ' WHERE l.tenant_id = ?'; params.push(tenant_id); }
  sql += ' ORDER BY l.created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

router.post('/admin/check-now', authenticate, (req, res) => {
  try {
    const summary = runPastDueCheck();
    res.json(summary);
  } catch (err) {
    console.error('[late-fees] check-now failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PAST DUE CHECK — Core logic
// ============================================

function runPastDueCheck() {
  const settings = getLateFeeSettings();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Get all unpaid invoices with tenant info
  const candidates = db.prepare(`
    SELECT i.id, i.invoice_number, i.tenant_id, i.invoice_date, i.billing_period_start,
      i.late_fee, i.total_amount, i.balance_due, i.amount_paid, i.rent_amount,
      i.late_fee_auto_applied, i.late_fee_waived, i.status,
      t.first_name, t.last_name, t.lot_id, t.phone, t.email,
      COALESCE(t.payment_due_day, 1) as payment_due_day
    FROM invoices i
    JOIN tenants t ON i.tenant_id = t.id
    WHERE i.status IN ('pending', 'partial') AND i.balance_due > 0.005 AND COALESCE(i.deleted, 0) = 0
  `).all();

  let notified = 0;
  let autoApplied = 0;
  const results = [];

  for (const inv of candidates) {
    // Calculate the actual due date based on the tenant's payment_due_day
    // Use the billing period or invoice date to determine the month
    const invDate = new Date(inv.billing_period_start || inv.invoice_date);
    const dueDay = Math.min(inv.payment_due_day, 28);
    const dueDate = new Date(invDate.getFullYear(), invDate.getMonth(), dueDay);

    // If due date is before invoice date (e.g., due on 1st but invoiced on 15th), push to next month
    if (dueDate < invDate) {
      dueDate.setMonth(dueDate.getMonth() + 1);
    }

    const graceDueDate = new Date(dueDate);
    graceDueDate.setDate(graceDueDate.getDate() + settings.graceDays);

    if (today <= graceDueDate) continue; // Not past due yet

    const daysLate = Math.floor((today - dueDate) / 86400000);

    // Check if we already notified for this invoice
    const alreadyNotified = db.prepare('SELECT id FROM late_fee_checks WHERE invoice_id = ?').get(inv.id);

    if (settings.mode === 'auto' && !inv.late_fee_auto_applied && !inv.late_fee_waived) {
      // Auto-apply mode
      const feeAmount = calculateLateFee(settings, Number(inv.rent_amount) || 0);
      const newLateFee = (Number(inv.late_fee) || 0) + feeAmount;
      const newTotal = (Number(inv.total_amount) || 0) + feeAmount;
      const newBalance = (Number(inv.balance_due) || 0) + feeAmount;
      db.prepare('UPDATE invoices SET late_fee = ?, total_amount = ?, balance_due = ?, late_fee_auto_applied = 1 WHERE id = ?')
        .run(newLateFee, newTotal, newBalance, inv.id);
      db.prepare('INSERT INTO late_fee_log (invoice_id, tenant_id, action, amount, reason, admin_user) VALUES (?, ?, ?, ?, ?, ?)')
        .run(inv.id, inv.tenant_id, 'applied', feeAmount, 'Auto-applied (past grace period)', 'system');
      autoApplied++;
    }

    // Send notification if not already sent
    if (!alreadyNotified) {
      const feeAmount = calculateLateFee(settings, Number(inv.rent_amount) || 0);
      let emailSent = false, smsSent = false;

      if (settings.emailEnabled && settings.email) {
        try {
          emailSent = sendPastDueEmail(settings, inv, daysLate, feeAmount, dueDate);
        } catch (e) { console.error('[late-fees] email failed:', e.message); }
      }

      if (settings.smsEnabled && settings.smsNumber) {
        try {
          smsSent = sendPastDueSms(settings, inv, daysLate);
        } catch (e) { console.error('[late-fees] sms failed:', e.message); }
      }

      db.prepare('INSERT INTO late_fee_checks (invoice_id, email_sent, sms_sent) VALUES (?, ?, ?)')
        .run(inv.id, emailSent ? 1 : 0, smsSent ? 1 : 0);
      notified++;
    }

    results.push({ invoice: inv.invoice_number, tenant: `${inv.first_name} ${inv.last_name}`, lot: inv.lot_id, daysLate });
  }

  return { checkedAt: todayStr, total: candidates.length, pastDue: results.length, notified, autoApplied, details: results };
}

function sendPastDueEmail(settings, inv, daysLate, feeAmount, dueDate) {
  const resend = getResend();
  const name = `${inv.first_name} ${inv.last_name}`;
  const dueDateStr = dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Generate tokens
  const applyToken = crypto.randomBytes(32).toString('hex');
  const waiveToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO late_fee_tokens (token, invoice_id, action, expires_at) VALUES (?, ?, ?, datetime(?))')
    .run(applyToken, inv.id, 'apply', expires);
  db.prepare('INSERT INTO late_fee_tokens (token, invoice_id, action, expires_at) VALUES (?, ?, ?, datetime(?))')
    .run(waiveToken, inv.id, 'waive', expires);

  const applyUrl = `${APP_URL}/api/late-fees/apply?token=${applyToken}`;
  const waiveUrl = `${APP_URL}/api/late-fees/waive?token=${waiveToken}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1c1917">
      <div style="background:#fef2f2;border:2px solid #dc2626;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem">
        <h2 style="color:#dc2626;margin:0 0 1rem">⚠️ Past Due Notice</h2>
        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:6px 0;color:#78716c;font-weight:600;width:40%">Guest</td><td style="padding:6px 0;font-weight:700">${name}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c;font-weight:600">Lot</td><td style="padding:6px 0;font-weight:700">${inv.lot_id}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c;font-weight:600">Invoice</td><td style="padding:6px 0;font-weight:700">${inv.invoice_number}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c;font-weight:600">Amount Due</td><td style="padding:6px 0;font-weight:700;color:#dc2626">$${Number(inv.balance_due).toFixed(2)}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c;font-weight:600">Due Date</td><td style="padding:6px 0;font-weight:700">${dueDateStr}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c;font-weight:600">Days Late</td><td style="padding:6px 0;font-weight:700;color:#dc2626">${daysLate} days</td></tr>
        </table>
      </div>
      <div style="text-align:center;margin:1.5rem 0">
        <p style="font-weight:700;font-size:16px;margin-bottom:1rem">Take Action:</p>
        <a href="${applyUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;font-size:16px;text-decoration:none;margin:0.5rem">✅ Apply Late Fee ($${feeAmount.toFixed(2)})</a>
        <br>
        <a href="${waiveUrl}" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;font-size:16px;text-decoration:none;margin:0.5rem">❌ Waive Late Fee</a>
      </div>
      <div style="border-top:1px solid #e7e5e4;padding-top:1rem;font-size:13px;color:#78716c">
        <p>You can also manage this from: <a href="${APP_URL}" style="color:#1a5c32">Admin Dashboard</a> → Billing & Invoices</p>
        <p>Links expire in 48 hours.</p>
        <p style="margin-top:1rem">— Anahuac RV Park System</p>
      </div>
    </div>`;

  resend.emails.send({
    from: FROM_ADDRESS,
    reply_to: REPLY_TO,
    to: settings.email,
    subject: `⚠️ Past Due — ${name} (Lot ${inv.lot_id}) — ${daysLate} Days Late`,
    html,
  });
  return true;
}

function sendPastDueSms(settings, inv, daysLate) {
  const name = `${inv.first_name} ${inv.last_name}`;
  const msg = `Anahuac RV Park: ${name} Lot ${inv.lot_id} is ${daysLate} days past due — $${Number(inv.balance_due).toFixed(2)} owed (${inv.invoice_number}). Manage at: ${APP_URL}`;
  sendSms(settings.smsNumber, msg);
  return true;
}

function renderPage(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} — Anahuac RV Park</title>
    <style>body{font-family:system-ui,-apple-system,sans-serif;background:#f5f5f4;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem}
    .card{background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:500px;width:100%;padding:2rem;text-align:center}
    h1{color:#1a5c32;font-size:1.3rem;margin-bottom:1rem}a{color:#1a5c32}</style></head>
    <body><div class="card"><h1>${title}</h1>${body}</div></body></html>`;
}

module.exports = router;
module.exports.runPastDueCheck = runPastDueCheck;
