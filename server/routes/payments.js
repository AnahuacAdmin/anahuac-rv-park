const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY environment variable.');
  }
  _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
      mode: 'payment',
      payment_method_types: ['card'],
      payment_method_options: {
        card: { request_three_d_secure: 'automatic' },
      },
      customer_email: invoice.email || undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Anahuac RV Park — Invoice ${invoice.invoice_number}`,
              description: `Lot ${invoice.lot_id} — ${invoice.first_name} ${invoice.last_name}`,
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
      success_url: `${origin}/?paid=1&invoice=${encodeURIComponent(invoice.invoice_number)}`,
      cancel_url:  `${origin}/pay.html?cancelled=1`,
    });

    res.json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('[payments] create-checkout-session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// All routes below require authentication.
router.use(authenticate);

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
  const { tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes, send_sms_receipt } = req.body;

  const result = db.prepare(`
    INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes);

  let newBalance = null;
  let invoiceNumber = null;
  let overpayment = 0;

  // Update invoice if linked
  if (invoice_id) {
    const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?').get(invoice_id);
    const invoice = db.prepare('SELECT total_amount, invoice_number FROM invoices WHERE id = ?').get(invoice_id);
    const balance = (invoice?.total_amount || 0) - totalPaid.total;
    const status = balance <= 0 ? 'paid' : 'partial';
    db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
      .run(totalPaid.total, Math.max(0, balance), status, invoice_id);
    newBalance = Math.max(0, balance);
    invoiceNumber = invoice?.invoice_number;

    // Overpayment: if balance went negative, add the excess as tenant credit.
    if (balance < -0.005) {
      overpayment = +Math.abs(balance).toFixed(2);
      db.prepare('UPDATE tenants SET credit_balance = credit_balance + ? WHERE id = ?').run(overpayment, tenant_id);
      console.log(`[payments] overpayment of $${overpayment} added as credit to tenant ${tenant_id}`);
    }

    // Clear eviction warning if tenant has no remaining unpaid invoices.
    if (balance <= 0) {
      const unpaid = db.prepare(
        "SELECT COUNT(*) as cnt FROM invoices WHERE tenant_id = ? AND balance_due > 0.005 AND status IN ('pending','partial') AND COALESCE(deleted,0) = 0"
      ).get(tenant_id);
      if (!unpaid || unpaid.cnt === 0) {
        db.prepare('UPDATE tenants SET eviction_warning = 0 WHERE id = ?').run(tenant_id);
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

  res.json({ id: result.lastInsertRowid, smsReceipt: smsResult, overpayment });
});

router.delete('/:id', (req, res) => {
  const payment = db.prepare('SELECT invoice_id, amount FROM payments WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);

  if (payment?.invoice_id) {
    const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?').get(payment.invoice_id);
    const invoice = db.prepare('SELECT total_amount FROM invoices WHERE id = ?').get(payment.invoice_id);
    const balance = (invoice?.total_amount || 0) - totalPaid.total;
    db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
      .run(totalPaid.total, Math.max(0, balance), balance <= 0 ? 'paid' : 'pending', payment.invoice_id);
  }

  res.json({ success: true });
});

module.exports = router;
