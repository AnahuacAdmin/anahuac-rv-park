/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

router.use(authenticate);

const APP_URL = process.env.APP_URL || 'https://web-production-89794.up.railway.app';

// Get all data needed for checkout settlement form
router.get('/checkout-data/:tenantId', (req, res) => {
  const tenant = db.prepare(`
    SELECT t.id, t.first_name, t.last_name, t.lot_id, t.monthly_rent, t.deposit_amount,
      t.deposit_waived, t.credit_balance, t.flat_rate, t.flat_rate_amount, t.move_in_date,
      COALESCE((SELECT SUM(i.balance_due) FROM invoices i WHERE i.tenant_id = t.id
        AND i.status IN ('pending','partial') AND COALESCE(i.deleted,0)=0), 0) AS balance_due
    FROM tenants t WHERE t.id = ?
  `).get(req.params.tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  // Get latest meter reading for the lot
  const lastReading = db.prepare(`
    SELECT id, current_reading, reading_date, rate_per_kwh
    FROM meter_readings WHERE lot_id = ? ORDER BY reading_date DESC LIMIT 1
  `).get(tenant.lot_id);

  // Get current month's invoice to know what's already paid
  const now = new Date();
  const monthStart = now.toISOString().slice(0, 7) + '-01';
  const currentInvoice = db.prepare(`
    SELECT id, invoice_number, rent_amount, electric_amount, total_amount, amount_paid, balance_due, status
    FROM invoices WHERE tenant_id = ? AND invoice_date >= ? AND COALESCE(deleted,0)=0
    ORDER BY invoice_date DESC LIMIT 1
  `).get(tenant.id, monthStart);

  // Electric rate from settings
  const rateSetting = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
  const electricRate = rateSetting ? parseFloat(rateSetting.value) : 0.15;

  res.json({
    tenant,
    lastReading: lastReading || null,
    currentInvoice: currentInvoice || null,
    electricRate,
  });
});

router.get('/', (req, res) => {
  const checkins = db.prepare(`
    SELECT c.*, t.first_name, t.last_name, l.id as lot_name
    FROM checkins c
    JOIN tenants t ON c.tenant_id = t.id
    JOIN lots l ON c.lot_id = l.id
    ORDER BY c.created_at DESC
  `).all();
  res.json(checkins);
});

router.post('/checkin', (req, res) => {
  try {
    const { tenant_id, lot_id, check_in_date, notes } = req.body;
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
    const result = db.prepare(`
      INSERT INTO checkins (tenant_id, lot_id, check_in_date, status, notes)
      VALUES (?, ?, ?, 'checked_in', ?)
    `).run(tenant_id, lot_id, str(check_in_date), str(notes));
    db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('occupied', lot_id);

    // Auto-send welcome SMS (non-blocking — failure doesn't break check-in).
    try {
      const tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id = ?').get(tenant_id);
      if (tenant?.phone) {
        const wifiRow = db.prepare("SELECT value FROM settings WHERE key = 'wifi_password'").get();
        const wifiLine = wifiRow?.value ? `\nWiFi Password: ${wifiRow.value}\n` : '';
        const welcomeMsg = `Welcome to Anahuac RV Park! We're glad you're here!\n\nLot: ${lot_id}\nContact: 409-267-6603 | anrvpark.com${wifiLine}\n\nPARK RULES SUMMARY:\n- Rent due on time — late fees apply after 3 days\n- Speed limit: 5 MPH — children & ducks in park!\n- Quiet hours: 10pm–7am\n- Pets welcome on leash — clean up after them\n- Max 2 people/cars per space ($25/extra person)\n- No fires except pits/rings. No fireworks. No weapons.\n- Keep your site clean at all times\n- No subleasing. No sharing WiFi password.\n- Guests: max 2 visitors at a time\n\nPay invoices online: ${APP_URL}\n\nWelcome to your new home away from home! 🦆`;
        sendSms(tenant.phone, welcomeMsg).then(r => {
          console.log(`[checkins] welcome SMS sent to ${r.to}, sid=${r.sid}`);
        }).catch(e => {
          console.error('[checkins] welcome SMS failed (non-fatal):', e.message);
        });
      }
    } catch (smsErr) {
      console.error('[checkins] welcome SMS setup failed (non-fatal):', smsErr.message);
    }

    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    console.error('[checkins] checkin failed:', err);
    res.status(500).json({ error: 'Check-in failed: ' + err.message });
  }
});

router.post('/checkout', async (req, res) => {
  try {
  const { tenant_id, lot_id, check_out_date, notes,
    // Proration
    prorate_rent, days_occupied, days_in_month,
    // Electric
    electric_previous, electric_current, electric_rate, electric_charge,
    // Deposit
    deposit_action, deposit_deduction, deposit_deduction_reason,
    // Other charges
    other_charges,
    // Settlement method
    settlement_method, settlement_reference,
  } = req.body;

  // Mark checkout
  db.prepare(`
    UPDATE checkins SET check_out_date = ?, status = 'checked_out', notes = ?
    WHERE tenant_id = ? AND lot_id = ? AND status = 'checked_in'
  `).run(check_out_date, notes, tenant_id, lot_id);

  db.prepare('UPDATE tenants SET is_active = 0, move_out_date = ? WHERE id = ?')
    .run(check_out_date, tenant_id);
  db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('vacant', lot_id);

  const tenant = db.prepare('SELECT first_name, last_name, deposit_amount, deposit_waived, monthly_rent, credit_balance, lot_id, phone, email, move_in_date FROM tenants WHERE id = ?').get(tenant_id);
  const tenantName = tenant ? `${tenant.first_name} ${tenant.last_name}` : 'Unknown';
  const monthlyRent = Number(tenant?.monthly_rent) || 0;
  const deposit = Number(tenant?.deposit_amount) || 0;
  const tenantCredit = Number(tenant?.credit_balance) || 0;

  // === RENT PRORATION ===
  let rentRefund = 0;
  let proratedRent = monthlyRent;
  if (prorate_rent && days_occupied != null && days_in_month > 0) {
    const dailyRate = +(monthlyRent / days_in_month).toFixed(2);
    proratedRent = +(dailyRate * days_occupied).toFixed(2);
    rentRefund = +(monthlyRent - proratedRent).toFixed(2);
    if (rentRefund < 0) rentRefund = 0;
  }

  // === ELECTRIC ===
  let electricTotal = 0;
  if (electric_current != null && electric_previous != null) {
    const kwh = Math.max(0, electric_current - electric_previous);
    const rate = electric_rate || 0.15;
    electricTotal = +(kwh * rate).toFixed(2);
    // Record final meter reading
    db.prepare(`INSERT INTO meter_readings (tenant_id, lot_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(tenant_id, lot_id, check_out_date, electric_previous, electric_current, kwh, rate, electricTotal);
  }

  // === DEPOSIT ===
  let depositRefund = 0;
  let depositDeduction = 0;
  if (deposit > 0 && deposit_action) {
    const ded = Math.min(Math.max(Number(deposit_deduction) || 0, 0), deposit);
    switch (deposit_action) {
      case 'full_refund':
        depositRefund = deposit;
        break;
      case 'partial':
        depositDeduction = ded;
        depositRefund = +(deposit - ded).toFixed(2);
        break;
      case 'forfeit':
        depositDeduction = deposit;
        depositRefund = 0;
        break;
    }
    db.prepare('UPDATE tenants SET deposit_amount = 0 WHERE id = ?').run(tenant_id);
  }

  // === OTHER CHARGES ===
  let otherTotal = 0;
  const charges = Array.isArray(other_charges) ? other_charges : [];
  for (const c of charges) {
    otherTotal += +(Number(c.amount) || 0).toFixed(2);
  }
  otherTotal = +otherTotal.toFixed(2);

  // === SETTLEMENT CALCULATION ===
  // Positive = due to tenant, Negative = due from tenant
  const netSettlement = +(rentRefund + depositRefund + tenantCredit - electricTotal - otherTotal).toFixed(2);

  // Record settlement note
  const parts = [];
  if (rentRefund > 0) parts.push(`Rent refund: $${rentRefund.toFixed(2)} (prorated ${days_occupied}/${days_in_month} days)`);
  if (electricTotal > 0) parts.push(`Electric: $${electricTotal.toFixed(2)} (${electric_current - electric_previous} kWh)`);
  if (deposit > 0) parts.push(`Deposit: $${deposit.toFixed(2)} → ${deposit_action}${depositDeduction > 0 ? ' (deducted $' + depositDeduction.toFixed(2) + (deposit_deduction_reason ? ': ' + deposit_deduction_reason : '') + ')' : ''}`);
  if (otherTotal > 0) parts.push(`Other charges: $${otherTotal.toFixed(2)}`);
  if (tenantCredit > 0) parts.push(`Credit applied: $${tenantCredit.toFixed(2)}`);
  parts.push(`NET SETTLEMENT: $${Math.abs(netSettlement).toFixed(2)} ${netSettlement >= 0 ? 'to tenant' : 'from tenant'}`);
  const settlementNote = 'MOVE-OUT SETTLEMENT: ' + parts.join(' | ');
  const fullNotes = notes ? notes + '\n' + settlementNote : settlementNote;
  db.prepare("UPDATE checkins SET notes = ? WHERE tenant_id = ? AND lot_id = ? AND status = 'checked_out'")
    .run(fullNotes, tenant_id, lot_id);

  // Record financial transactions
  if (netSettlement > 0) {
    // Park owes tenant: record as negative payment (refund)
    db.prepare('INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes) VALUES (?, NULL, ?, ?, ?, ?, ?)')
      .run(tenant_id, check_out_date, -netSettlement, settlement_method || 'cash', settlement_reference || 'CHECKOUT', 'Move-out settlement refund');
  } else if (netSettlement < 0) {
    // Tenant owes park: record as payment received
    db.prepare('INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes) VALUES (?, NULL, ?, ?, ?, ?, ?)')
      .run(tenant_id, check_out_date, Math.abs(netSettlement), settlement_method || 'cash', settlement_reference || 'CHECKOUT', 'Move-out settlement payment');
  }

  // Clear credit balance (used in settlement)
  if (tenantCredit > 0) {
    db.prepare('UPDATE tenants SET credit_balance = 0 WHERE id = ?').run(tenant_id);
    db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, notes)
      VALUES (?, 'applied_to_invoice', ?, ?)`).run(tenant_id, -tenantCredit, 'Credit applied at move-out settlement');
  }

  // Generate statement number: MO-YYYY-MM-NNN
  const coMonth = check_out_date.slice(0, 7); // YYYY-MM
  const moCount = db.prepare("SELECT COUNT(*) as c FROM checkins WHERE status = 'checked_out' AND check_out_date LIKE ?").get(coMonth + '%')?.c || 1;
  const statementNumber = 'MO-' + coMonth.replace('-', '-') + '-' + String(moCount).padStart(3, '0');

  const statement = {
    statement_number: statementNumber,
    tenant_name: tenantName,
    lot_id,
    move_in_date: tenant?.move_in_date || null,
    checkout_date: check_out_date,
    statement_date: check_out_date,
    monthly_rent: monthlyRent,
    prorate_rent: !!prorate_rent,
    days_occupied: days_occupied || null,
    days_in_month: days_in_month || null,
    prorated_rent: proratedRent,
    rent_refund: rentRefund,
    electric_previous: electric_previous || null,
    electric_current: electric_current || null,
    electric_kwh: electric_current != null && electric_previous != null ? Math.max(0, electric_current - electric_previous) : 0,
    electric_rate: electric_rate || 0.15,
    electric_charge: electricTotal,
    deposit,
    deposit_action: deposit_action || null,
    deposit_refund: depositRefund,
    deposit_deduction: depositDeduction,
    deposit_deduction_reason: deposit_deduction_reason || '',
    other_charges: charges,
    other_total: otherTotal,
    credit_applied: tenantCredit,
    net_settlement: netSettlement,
    settlement_method: settlement_method || null,
    settlement_reference: settlement_reference || null,
  };

  res.json({
    success: true,
    statement,
    tenant_id,
    tenant_name: tenantName,
    tenant_phone: tenant?.phone || null,
    tenant_email: tenant?.email || null,
  });
  } catch (err) {
    console.error('[checkins] checkout failed:', err);
    res.status(500).json({ error: 'Check-out failed: ' + err.message });
  }
});

// Send welcome SMS (two messages) to a newly checked-in tenant.
router.post('/welcome-sms/:tenantId', async (req, res) => {
  try {
    const tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id = ?').get(req.params.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (!tenant.phone) return res.json({ sent: false, reason: 'No phone on file' });

    const msg1 = `Welcome to Anahuac RV Park! We are so glad you chose us as your home. Here is your app link to manage your account and pay online: ${APP_URL}`;
    const msg2 = `PARK RULES: Quiet hours 10pm-7am. Speed limit 5mph. Keep your lot clean. Rent due 1st of month, late after 5th. No open fires. Pets on leash. Questions? Call 409-267-6603`;

    await sendSms(tenant.phone, msg1);
    await sendSms(tenant.phone, msg2);

    res.json({ sent: true, sentTo: tenant.phone });
  } catch (err) {
    console.error('[checkins] welcome sms failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
