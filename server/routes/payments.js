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
const pushService = require('../services/push-notifications');

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY environment variable.');
  }
  _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2022-11-15',   // Pin to pre-Link-auto-enable API version
  });
  return _stripe;
}

// Public route — no authentication required so tenants can pay from the
// standalone pay.html page without logging in.
router.post('/create-checkout-session', async (req, res) => {
  try {
    const invoiceId = parseInt(req.body?.invoice_id);
    if (!invoiceId) return res.status(400).json({ error: 'invoice_id is required' });

    const invoice = db.prepare(`
      SELECT i.*, t.first_name, t.last_name, t.email, t.lot_id
      FROM invoices i
      JOIN tenants t ON i.tenant_id = t.id
      WHERE i.id = ? AND COALESCE(i.deleted, 0) = 0
    `).get(invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const balance = Number(invoice.balance_due) || 0;
    if (balance <= 0.005) return res.status(400).json({ error: 'Invoice has no balance due' });

    const balanceCents = Math.round(balance * 100);
    const feeCents = Math.round(balanceCents * 0.03);

    const stripe = getStripe();
    const origin = req.headers.origin || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Anahuac RV Park — Invoice Payment',
            },
            unit_amount: balanceCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Convenience Fee (3%)' },
            unit_amount: feeCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoice_id: String(invoice.id),
        invoice_number: invoice.invoice_number,
        lot_id: invoice.lot_id,
      },
      success_url: `${origin}/?paid=1`,
      cancel_url:  `${origin}/pay.html?cancelled=1`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[payments] create-checkout-session failed:', err);
    res.status(500).json({ error: 'Payment session creation failed' });
  }
});

// All routes below require authentication + admin role (financial data).
router.use(authenticate);
const { blockStaff } = require('../middleware');
router.use(blockStaff);

// Diagnostic: detailed invoice breakdown for investigation
router.get('/invoice-audit', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
  const invoices = db.prepare(`
    SELECT i.id, i.invoice_number, i.invoice_date, i.status, i.rent_amount, i.electric_amount,
      i.late_fee, COALESCE(i.mailbox_fee,0) AS mailbox_fee, COALESCE(i.misc_fee,0) AS misc_fee,
      COALESCE(i.refund_amount,0) AS refund_amount, i.subtotal, i.total_amount, i.amount_paid,
      i.balance_due, COALESCE(i.credit_applied,0) AS credit_applied, COALESCE(i.deleted,0) AS deleted,
      t.first_name, t.last_name, t.lot_id, t.flat_rate, t.monthly_rent
    FROM invoices i
    JOIN tenants t ON i.tenant_id = t.id
    WHERE i.invoice_date LIKE ? || '%'
    ORDER BY t.lot_id
  `).all(month);
  const totals = {
    rent: invoices.filter(i=>!i.deleted).reduce((s,i)=>s+i.rent_amount,0),
    electric: invoices.filter(i=>!i.deleted).reduce((s,i)=>s+i.electric_amount,0),
    late_fees: invoices.filter(i=>!i.deleted).reduce((s,i)=>s+i.late_fee,0),
    mailbox: invoices.filter(i=>!i.deleted).reduce((s,i)=>s+i.mailbox_fee,0),
    misc: invoices.filter(i=>!i.deleted).reduce((s,i)=>s+i.misc_fee,0),
    refunds: invoices.filter(i=>!i.deleted).reduce((s,i)=>s+i.refund_amount,0),
    total: invoices.filter(i=>!i.deleted).reduce((s,i)=>s+i.total_amount,0),
    count: invoices.filter(i=>!i.deleted).length,
    deleted_count: invoices.filter(i=>i.deleted).length,
  };
  res.json({ month, invoices, totals });
});

router.get('/summary', (req, res) => {
  // Revenue breakdown from paid/partial invoices
  const inv = db.prepare(`
    SELECT
      COALESCE(SUM(rent_amount), 0) AS rent,
      COALESCE(SUM(electric_amount), 0) AS electric,
      COALESCE(SUM(late_fee), 0) AS late_fees,
      COALESCE(SUM(mailbox_fee), 0) AS mailbox,
      COALESCE(SUM(misc_fee), 0) AS misc
    FROM invoices WHERE status IN ('paid','partial') AND COALESCE(deleted, 0) = 0
  `).get();
  // Refunds from payments table (negative amounts)
  const ref = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE amount < 0`).get();
  // Total actually collected (positive payments)
  const col = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE amount > 0`).get();
  const txn = db.prepare(`SELECT COUNT(*) AS count FROM payments`).get();
  res.json({
    rent: inv.rent, electric: inv.electric, late_fees: inv.late_fees,
    mailbox: inv.mailbox, misc: inv.misc,
    refunded: ref.total, collected: col.total, transactions: txn.count,
  });
});

router.get('/', (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, t.first_name, t.last_name, t.lot_id, i.invoice_number
    FROM payments p
    JOIN tenants t ON p.tenant_id = t.id
    LEFT JOIN invoices i ON p.invoice_id = i.id
    ORDER BY p.payment_date DESC
  `).all();
  res.json(payments);
});

router.get('/tenant/:tenantId', (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, i.invoice_number
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.tenant_id = ?
    ORDER BY p.payment_date DESC
  `).all(req.params.tenantId);
  res.json(payments);
});

router.post('/', async (req, res) => {
  try {
  const { tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes, send_sms_receipt, hold_as_credit } = req.body;

  let newBalance = null;
  let invoiceNumber = null;
  let overpayment = 0;

  // "Hold as credit" mode: entire amount goes to credit balance, no invoice paid
  if (hold_as_credit) {
    const creditAmount = +Number(amount).toFixed(2);
    db.prepare('UPDATE tenants SET credit_balance = credit_balance + ? WHERE id = ?').run(creditAmount, tenant_id);
    const payResult = db.prepare(`
      INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes)
      VALUES (?, NULL, ?, ?, ?, ?, ?)
    `).run(tenant_id, payment_date, creditAmount, payment_method, reference_number, (notes ? notes + ' — ' : '') + 'Held as tenant credit');
    db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, payment_id, notes)
      VALUES (?, 'hold_as_credit', ?, ?, ?)`).run(tenant_id, creditAmount, payResult.lastInsertRowid,
      `$${creditAmount.toFixed(2)} held as credit via ${payment_method || 'cash'}`);

    // SMS receipt
    let smsResult = null;
    try {
      const tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id = ?').get(tenant_id);
      if (tenant?.phone) {
        const body = `Payment Received - Anahuac RV Park\nAmount: $${creditAmount.toFixed(2)} (held as account credit)\nMethod: ${payment_method || 'N/A'}\nDate: ${payment_date}\nThank you! Questions? Call 409-267-6603`;
        await sendSms(tenant.phone, body);
        smsResult = { sent: true };
      }
    } catch (e) { smsResult = { sent: false, reason: e.message }; }

    return res.json({ id: payResult.lastInsertRowid, smsReceipt: smsResult, overpayment: 0, held_as_credit: creditAmount });
  }

  const result = db.prepare(`
    INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes);

  // Update invoice if linked
  if (invoice_id) {
    const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?').get(invoice_id);
    const invoice = db.prepare('SELECT total_amount, invoice_number, COALESCE(credit_applied,0) as credit_applied FROM invoices WHERE id = ?').get(invoice_id);
    const balance = (invoice?.total_amount || 0) - totalPaid.total - (invoice?.credit_applied || 0);
    const status = balance <= 0.01 ? 'paid' : 'partial';
    db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
      .run(totalPaid.total, Math.max(0, balance), status, invoice_id);
    newBalance = Math.max(0, balance);
    invoiceNumber = invoice?.invoice_number;

    // Overpayment: if balance went negative, add the excess as tenant credit.
    if (balance < -0.005) {
      overpayment = +Math.abs(balance).toFixed(2);
      db.prepare('UPDATE tenants SET credit_balance = credit_balance + ? WHERE id = ?').run(overpayment, tenant_id);
      db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, payment_id, invoice_id, notes)
        VALUES (?, 'overpayment', ?, ?, ?, ?)`).run(tenant_id, overpayment, result.lastInsertRowid, invoice_id,
        `Overpayment of $${overpayment.toFixed(2)} on ${invoiceNumber || 'invoice #' + invoice_id}`);
      console.log(`[payments] overpayment of $${overpayment} added as credit to tenant ${tenant_id}`);
    }

    // Clear eviction warning if tenant has no remaining unpaid invoices.
    if (balance <= 0) {
      const unpaid = db.prepare(
        "SELECT COUNT(*) as cnt FROM invoices WHERE tenant_id = ? AND balance_due > 0.005 AND status IN ('pending','partial') AND COALESCE(deleted,0) = 0"
      ).get(tenant_id);
      if (!unpaid || unpaid.cnt === 0) {
        db.prepare('UPDATE tenants SET eviction_warning = 0, eviction_notified = 0, eviction_paused = 0, eviction_pause_note = NULL WHERE id = ?').run(tenant_id);
      }
    }
  }

  // Auto-send SMS receipt (non-blocking — failure doesn't break payment).
  let smsResult = null;
  {
    try {
      const tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id = ?').get(tenant_id);
      if (tenant?.phone) {
        const balStr = newBalance !== null ? `$${newBalance.toFixed(2)}` : 'N/A';
        const dateStr = payment_date || new Date().toISOString().split('T')[0];
        const body = `Payment Received - Anahuac RV Park\nAmount: $${Number(amount).toFixed(2)}\nMethod: ${payment_method || 'N/A'}\nDate: ${dateStr}\nRemaining Balance: ${balStr}\nThank you! Questions? Call 409-267-6603`;
        await sendSms(tenant.phone, body);
        smsResult = { sent: true };
      } else {
        smsResult = { sent: false, reason: 'No phone on file' };
      }
    } catch (e) {
      console.error('[payments] sms receipt failed:', e);
      smsResult = { sent: false, reason: e.message };
    }
  }

  // Push notification to tenant (payment confirmed) and admin (payment received)
  try {
    const tn = db.prepare('SELECT first_name, last_name, lot_id FROM tenants WHERE id = ?').get(tenant_id);
    pushService.notifyTenant(tenant_id, { type: 'payment', title: '\u2705 Payment Received \u2014 Thank You!', body: '$' + Number(amount).toFixed(2) + ' paid via ' + (payment_method || 'cash') + '. Receipt available.', url: '/portal', priority: 'normal' });
    pushService.notifyAdmin({ type: 'payment', title: '\ud83d\udcb3 Payment from ' + (tn?.first_name || 'Tenant'), body: '$' + Number(amount).toFixed(2) + ' received from ' + (tn ? tn.first_name + ' ' + tn.last_name : 'Unknown') + ' (Lot ' + (tn?.lot_id || '?') + ') via ' + (payment_method || 'cash'), url: '/', priority: 'normal' });
  } catch {}
  res.json({ id: result.lastInsertRowid, smsReceipt: smsResult, overpayment });
  } catch (err) {
    console.error('[payments] record payment error:', err.message);
    res.status(500).json({ error: 'Failed to record payment: ' + err.message });
  }
});

// Process a Stripe refund
router.post('/refund', async (req, res) => {
  try {
    const { payment_id, amount, reason } = req.body || {};
    if (!payment_id) return res.status(400).json({ error: 'payment_id is required' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid refund amount is required' });
    if (!reason) return res.status(400).json({ error: 'Reason is required' });

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment_id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (amount > Number(payment.amount)) return res.status(400).json({ error: 'Refund amount exceeds payment amount' });

    // Check for existing refunds on this payment
    const existingRefunds = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM refunds WHERE payment_id = ?').get(payment_id);
    const maxRefund = Number(payment.amount) - (existingRefunds?.total || 0);
    if (amount > maxRefund + 0.005) return res.status(400).json({ error: `Maximum refundable amount is $${maxRefund.toFixed(2)}` });

    let stripeRefundId = null;

    // If this was a Stripe payment, process via Stripe API
    if (payment.reference_number && payment.payment_method === 'Credit Card') {
      const stripe = getStripe();
      const refAmountCents = Math.round(amount * 100);
      // The reference_number could be a checkout session ID or a payment intent ID
      const ref = payment.reference_number;

      try {
        let paymentIntentId = ref;
        // If it's a checkout session ID (cs_), retrieve the session to get the payment intent
        if (ref.startsWith('cs_')) {
          const session = await stripe.checkout.sessions.retrieve(ref);
          paymentIntentId = session.payment_intent;
        }
        if (!paymentIntentId) throw new Error('No payment intent found for this transaction');

        const refund = await stripe.refunds.create({
          payment_intent: paymentIntentId,
          amount: refAmountCents,
          reason: reason === 'Duplicate payment' ? 'duplicate' : reason === 'Billing error' ? 'requested_by_customer' : 'requested_by_customer',
        });
        stripeRefundId = refund.id;
      } catch (stripeErr) {
        console.error('[payments] Stripe refund failed:', stripeErr.message);
        return res.status(400).json({ error: 'Stripe refund failed: ' + stripeErr.message });
      }
    }

    // Record the refund
    const result = db.prepare(
      'INSERT INTO refunds (payment_id, invoice_id, tenant_id, amount, reason, stripe_refund_id, processed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(payment_id, payment.invoice_id, payment.tenant_id, amount, reason, stripeRefundId, req.user?.username || 'admin');

    // Update invoice: reduce amount_paid, increase balance_due
    if (payment.invoice_id) {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id);
      if (inv) {
        const newPaid = Math.max(0, (Number(inv.amount_paid) || 0) - amount);
        const credits = (Number(inv.credit_applied) || 0);
        const newBalance = (Number(inv.total_amount) || 0) - newPaid - credits;
        let newStatus = 'pending';
        if (newBalance <= 0.01) newStatus = 'paid';
        else if (newPaid > 0.005 || credits > 0.005) newStatus = 'partial';
        db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
          .run(newPaid, Math.max(0, newBalance), newStatus, inv.id);
      }
    }

    // Send SMS notification to tenant
    try {
      const tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id = ?').get(payment.tenant_id);
      if (tenant?.phone) {
        sendSms(tenant.phone, `Anahuac RV Park: A refund of $${amount.toFixed(2)} has been issued to your card. It will appear in 5-10 business days. Questions? 409-267-6603`).catch(() => {});
      }
    } catch {}

    res.json({ success: true, refund_id: result.lastInsertRowid, stripe_refund_id: stripeRefundId });
  } catch (err) {
    console.error('[payments] refund error:', err);
    res.status(500).json({ error: err.message || 'Refund processing failed' });
  }
});

// Get refunds for a payment
router.get('/refunds/:paymentId', (req, res) => {
  const refunds = db.prepare('SELECT * FROM refunds WHERE payment_id = ? ORDER BY created_at DESC').all(req.params.paymentId);
  res.json(refunds);
});

// Get refunds for an invoice
router.get('/invoice-refunds/:invoiceId', (req, res) => {
  const refunds = db.prepare('SELECT * FROM refunds WHERE invoice_id = ? ORDER BY created_at DESC').all(req.params.invoiceId);
  res.json(refunds);
});

router.delete('/:id', (req, res) => {
  const payment = db.prepare('SELECT invoice_id, amount FROM payments WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);

  if (payment?.invoice_id) {
    const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?').get(payment.invoice_id);
    const invoice = db.prepare('SELECT total_amount, COALESCE(credit_applied,0) as credit_applied FROM invoices WHERE id = ?').get(payment.invoice_id);
    const balance = (invoice?.total_amount || 0) - totalPaid.total - (invoice?.credit_applied || 0);
    let delStatus = 'pending';
    if (balance <= 0.01) delStatus = 'paid';
    else if (totalPaid.total > 0.005 || (invoice?.credit_applied || 0) > 0.005) delStatus = 'partial';
    db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
      .run(totalPaid.total, Math.max(0, balance), delStatus, payment.invoice_id);
  }

  res.json({ success: true });
});

module.exports = router;
