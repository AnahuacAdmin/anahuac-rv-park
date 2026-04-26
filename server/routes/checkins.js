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
  const { tenant_id, lot_id, check_out_date, notes, deposit_action, deduction_amount, deduction_reason,
    payment_amount, payment_method, payment_invoice_id, payment_reference } = req.body;

  db.prepare(`
    UPDATE checkins SET check_out_date = ?, status = 'checked_out', notes = ?
    WHERE tenant_id = ? AND lot_id = ? AND status = 'checked_in'
  `).run(check_out_date, notes, tenant_id, lot_id);

  db.prepare('UPDATE tenants SET is_active = 0, move_out_date = ? WHERE id = ?')
    .run(check_out_date, tenant_id);
  db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('vacant', lot_id);

  // Deposit settlement
  const tenant = db.prepare('SELECT first_name, last_name, deposit_amount, lot_id, phone, email FROM tenants WHERE id = ?').get(tenant_id);
  const deposit = Number(tenant?.deposit_amount) || 0;
  let statement = null;

  if (deposit > 0 && deposit_action) {
    const balance = Number(
      db.prepare("SELECT COALESCE(SUM(balance_due),0) as b FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0").get(tenant_id)?.b
    ) || 0;

    let refund = 0;
    let deduction = 0;
    let appliedToBalance = 0;
    let actionLabel = '';
    const ded = Math.min(Math.max(Number(deduction_amount) || 0, 0), deposit);
    const dedReason = deduction_reason || '';

    switch (deposit_action) {
      case 'full_refund':
        refund = deposit;
        actionLabel = 'Full Refund';
        break;
      case 'partial_refund':
        deduction = ded;
        refund = +(deposit - deduction).toFixed(2);
        actionLabel = 'Partial Refund';
        break;
      case 'apply_to_balance':
        appliedToBalance = +Math.min(deposit, balance).toFixed(2);
        refund = +(deposit - appliedToBalance).toFixed(2);
        actionLabel = 'Applied to Balance';
        // Apply deposit as payment to unpaid invoices
        if (appliedToBalance > 0) {
          let remaining = appliedToBalance;
          const unpaid = db.prepare("SELECT id, balance_due FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0 ORDER BY invoice_date ASC").all(tenant_id);
          for (const inv of unpaid) {
            if (remaining <= 0) break;
            const apply = Math.min(remaining, Number(inv.balance_due));
            db.prepare('UPDATE invoices SET amount_paid = amount_paid + ?, balance_due = balance_due - ?, status = CASE WHEN balance_due - ? <= 0.005 THEN \'paid\' ELSE \'partial\' END WHERE id = ?')
              .run(apply, apply, apply, inv.id);
            // Record as payment
            db.prepare('INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(tenant_id, inv.id, check_out_date, apply, 'Deposit', 'CHECKOUT', 'Deposit applied at checkout');
            remaining = +(remaining - apply).toFixed(2);
          }
        }
        break;
      case 'no_refund':
        deduction = deposit;
        refund = 0;
        actionLabel = 'No Refund (Forfeited)';
        break;
    }

    // Record the deposit settlement note on the checkin record
    const settlementNote = `DEPOSIT SETTLEMENT: ${actionLabel}. Deposit: $${deposit.toFixed(2)}` +
      (deduction > 0 ? `, Deductions: $${deduction.toFixed(2)}${dedReason ? ' (' + dedReason + ')' : ''}` : '') +
      (appliedToBalance > 0 ? `, Applied to balance: $${appliedToBalance.toFixed(2)}` : '') +
      `, Refund: $${refund.toFixed(2)}`;
    const existingNotes = notes ? notes + '\n' + settlementNote : settlementNote;
    db.prepare("UPDATE checkins SET notes = ? WHERE tenant_id = ? AND lot_id = ? AND status = 'checked_out'")
      .run(existingNotes, tenant_id, lot_id);

    // Clear the deposit from tenant record
    db.prepare('UPDATE tenants SET deposit_amount = 0 WHERE id = ?').run(tenant_id);

    // If there's a refund due that wasn't applied to balance, record as negative payment for audit trail
    if (refund > 0 && deposit_action !== 'apply_to_balance') {
      db.prepare('INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes) VALUES (?, NULL, ?, ?, ?, ?, ?)')
        .run(tenant_id, check_out_date, -refund, 'Deposit Refund', 'CHECKOUT', `Deposit refund at checkout${dedReason ? ' (deductions: ' + dedReason + ')' : ''}`);
    }

    const remainingBalance = deposit_action === 'apply_to_balance' ? Math.max(0, +(balance - appliedToBalance).toFixed(2)) : balance;

    statement = {
      tenant_name: `${tenant.first_name} ${tenant.last_name}`,
      lot_id: lot_id,
      checkout_date: check_out_date,
      deposit,
      deduction,
      deduction_reason: dedReason,
      applied_to_balance: appliedToBalance,
      refund,
      remaining_balance: remainingBalance,
      action_label: actionLabel,
    };
  }

  // Final Payment at checkout
  let paymentRecorded = null;
  let smsResult = null;
  if (payment_amount && payment_amount > 0 && payment_method) {
    const payResult = db.prepare(
      'INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(tenant_id, payment_invoice_id || null, check_out_date, payment_amount, payment_method, payment_reference || null, 'Payment recorded at checkout');

    paymentRecorded = payment_amount;

    // Update invoice if linked
    if (payment_invoice_id) {
      const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?').get(payment_invoice_id);
      const invoice = db.prepare('SELECT total_amount FROM invoices WHERE id = ?').get(payment_invoice_id);
      const invBalance = (invoice?.total_amount || 0) - totalPaid.total;
      const invStatus = invBalance <= 0.005 ? 'paid' : 'partial';
      db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
        .run(totalPaid.total, Math.max(0, invBalance), invStatus, payment_invoice_id);

      // Overpayment → tenant credit
      if (invBalance < -0.005) {
        const overpay = +Math.abs(invBalance).toFixed(2);
        db.prepare('UPDATE tenants SET credit_balance = credit_balance + ? WHERE id = ?').run(overpay, tenant_id);
      }

      // Clear eviction flags if fully paid
      if (invBalance <= 0.005) {
        const unpaid = db.prepare(
          "SELECT COUNT(*) as cnt FROM invoices WHERE tenant_id = ? AND balance_due > 0.005 AND status IN ('pending','partial') AND COALESCE(deleted,0) = 0"
        ).get(tenant_id);
        if (!unpaid || unpaid.cnt === 0) {
          db.prepare('UPDATE tenants SET eviction_warning = 0, eviction_notified = 0, eviction_paused = 0, eviction_pause_note = NULL WHERE id = ?').run(tenant_id);
        }
      }
    }

    // Auto-send SMS receipt (non-blocking)
    try {
      if (tenant?.phone) {
        const remBal = Math.max(0, (db.prepare('SELECT balance_due FROM invoices WHERE id = ?').get(payment_invoice_id)?.balance_due || 0));
        const balStr = payment_invoice_id ? `$${remBal.toFixed(2)}` : 'N/A';
        const body = `Payment Received - Anahuac RV Park\nAmount: $${Number(payment_amount).toFixed(2)}\nMethod: ${payment_method}\nDate: ${check_out_date}\nRemaining Balance: ${balStr}\nThank you! Questions? Call 409-267-6603`;
        await sendSms(tenant.phone, body);
        smsResult = { sent: true };
      }
    } catch (e) {
      console.error('[checkout] sms receipt failed:', e);
      smsResult = { sent: false, reason: e.message };
    }
  }

  res.json({
    success: true,
    statement,
    tenant_id,
    tenant_name: tenant ? `${tenant.first_name} ${tenant.last_name}` : null,
    tenant_phone: tenant?.phone || null,
    tenant_email: tenant?.email || null,
    payment_recorded: paymentRecorded,
    sms_receipt: smsResult,
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
