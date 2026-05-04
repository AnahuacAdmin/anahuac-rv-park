/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const { db } = require('../database');
const { SECRET, TOKEN_TTL } = require('../middleware');
const { sendSms } = require('../twilio');

function getManagerPhone() {
  return db.prepare("SELECT value FROM settings WHERE key = 'manager_phone'").get()?.value;
}
const APP_URL = process.env.APP_URL || 'https://web-production-89794.up.railway.app';

// Track failed PIN attempts keyed by lot+IP for brute force protection.
// Tiered lockouts: 5 fails = 15 min, 10 fails = 1 hr, 15+ fails = 4 hr.
const _failedAttempts = {};

function getAttemptKey(req, lotId) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  return `${String(lotId).toLowerCase()}_${ip}`;
}

function checkLockout(key) {
  const entry = _failedAttempts[key];
  if (!entry) return null;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return `Too many login attempts. Please try again in ${mins} minute${mins !== 1 ? 's' : ''}. Call 409-267-6603 for assistance.`;
  }
  // Lockout expired — clear it but keep count
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    entry.lockedUntil = null;
  }
  return null;
}

function recordFailure(key) {
  if (!_failedAttempts[key]) _failedAttempts[key] = { count: 0, lockedUntil: null };
  const entry = _failedAttempts[key];
  entry.count++;
  if (entry.count >= 15) {
    entry.lockedUntil = Date.now() + 4 * 60 * 60 * 1000; // 4 hours
  } else if (entry.count >= 10) {
    entry.lockedUntil = Date.now() + 60 * 60 * 1000; // 1 hour
  } else if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 minutes
  }
  return entry.count;
}

function clearFailures(key) {
  delete _failedAttempts[key];
}

// Admin preview tokens (in-memory, short-lived)
const _previewTokens = new Map();
const PREVIEW_TTL = 15 * 60 * 1000; // 15 minutes

// Generate an admin preview token (requires admin JWT)
router.post('/admin-preview', (req, res) => {
  const authHeader = req.headers.authorization?.split(' ')[1];
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = jwt.verify(authHeader, SECRET);
    // Allow admin role OR existing preview tokens (for tenant switching)
    if (user.role !== 'admin' && !user.preview) return res.status(403).json({ error: 'Admin access required' });
  } catch { return res.status(401).json({ error: 'Invalid token' }); }

  // Use specific tenant if requested, otherwise first active tenant
  const requestedId = req.body?.tenant_id;
  const tenant = requestedId
    ? db.prepare('SELECT id, first_name, last_name, lot_id, phone, email FROM tenants WHERE id = ? AND is_active = 1').get(requestedId)
    : db.prepare('SELECT id, first_name, last_name, lot_id, phone, email FROM tenants WHERE is_active = 1 LIMIT 1').get();
  if (!tenant) return res.status(404).json({ error: 'No active tenants to preview' });

  const token = 'prev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  _previewTokens.set(token, { tenantId: tenant.id, createdAt: Date.now() });

  // Clean expired tokens
  for (const [k, v] of _previewTokens) {
    if (Date.now() - v.createdAt > PREVIEW_TTL) _previewTokens.delete(k);
  }

  // Generate a real tenant JWT so the portal API calls work
  const tenantJwt = jwt.sign({ id: tenant.id, role: 'tenant', lot_id: tenant.lot_id, preview: true }, SECRET, { expiresIn: '15m' });

  res.json({ token: tenantJwt, previewToken: token, tenant: { id: tenant.id, first_name: tenant.first_name, last_name: tenant.last_name, lot_id: tenant.lot_id } });
});

// List all active tenants for admin preview switcher
router.get('/admin-preview-tenants', (req, res) => {
  const authHeader = req.headers.authorization?.split(' ')[1];
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = jwt.verify(authHeader, SECRET);
    // Allow admin role OR preview tokens (which have role:tenant but preview:true)
    if (user.role !== 'admin' && !user.preview) return res.status(403).json({ error: 'Admin access required' });
  } catch { return res.status(401).json({ error: 'Invalid token' }); }

  const tenants = db.prepare('SELECT id, first_name, last_name, lot_id FROM tenants WHERE is_active = 1 ORDER BY lot_id').all();
  res.json(tenants);
});

// Public: local links for portal
router.get('/local-links', (req, res) => {
  res.json(db.prepare('SELECT id, category, name, emoji, url FROM portal_local_links WHERE is_active=1 ORDER BY category, display_order, id').all());
});

// Public: restaurants for portal
router.get('/restaurants', (req, res) => {
  res.json(db.prepare('SELECT id, name, emoji, url FROM portal_restaurants WHERE is_active=1 ORDER BY display_order, id').all());
});

// Stripe publishable key for frontend
router.get('/stripe-key', (req, res) => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY || '';
  if (!key) return res.status(500).json({ error: 'Payment system not configured' });
  res.json({ publishableKey: key });
});

// Tenant login — lot number + last name + PIN
router.post('/login', (req, res) => {
  const { lot_id, last_name, pin } = req.body || {};
  if (!lot_id || !last_name) return res.status(400).json({ error: 'Lot number and last name are required' });

  const tenant = db.prepare(`
    SELECT t.id, t.first_name, t.last_name, t.lot_id, t.phone, t.email, t.portal_pin
    FROM tenants t
    WHERE LOWER(t.lot_id) = LOWER(?) AND LOWER(t.last_name) = LOWER(?) AND t.is_active = 1
    LIMIT 1
  `).get(lot_id.trim(), last_name.trim());

  if (!tenant) return res.status(401).json({ error: 'Invalid credentials. Please check your lot number and last name, or contact management.' });

  // Check lockout (keyed by lot + IP)
  const key = getAttemptKey(req, lot_id);
  const lockoutMsg = checkLockout(key);
  if (lockoutMsg) return res.status(429).json({ error: lockoutMsg });

  // If no PIN set, tell frontend to show setup screen
  if (!tenant.portal_pin) {
    return res.json({ needs_pin_setup: true, tenant_id: tenant.id, lot_id: tenant.lot_id, first_name: tenant.first_name, last_name: tenant.last_name });
  }

  // PIN is set — require it
  if (!pin) return res.status(400).json({ error: 'PIN is required', needs_pin: true });

  if (!bcrypt.compareSync(String(pin), tenant.portal_pin)) {
    const totalFails = recordFailure(key);
    const newLockout = checkLockout(key);
    if (newLockout) return res.status(429).json({ error: newLockout });
    const threshold = totalFails < 5 ? 5 : totalFails < 10 ? 10 : 15;
    const remaining = threshold - totalFails;
    return res.status(401).json({ error: `Incorrect PIN. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining before lockout.`, needs_pin: true });
  }

  // Success — clear attempts
  clearFailures(key);
  db.prepare("UPDATE tenants SET last_portal_login = datetime('now'), portal_login_count = COALESCE(portal_login_count, 0) + 1 WHERE id = ?").run(tenant.id);
  const token = jwt.sign({ id: tenant.id, lot_id: tenant.lot_id, role: 'tenant', name: `${tenant.first_name} ${tenant.last_name}` }, SECRET, { expiresIn: '2h' });
  res.json({ token, tenant: { id: tenant.id, first_name: tenant.first_name, last_name: tenant.last_name, lot_id: tenant.lot_id } });
});

// Set up PIN for first time
router.post('/setup-pin', (req, res) => {
  try {
    const { lot_id, last_name, pin } = req.body || {};
    if (!lot_id || !last_name || !pin) return res.status(400).json({ error: 'All fields required' });
    if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });

    const tenant = db.prepare(`
      SELECT t.id, t.first_name, t.last_name, t.lot_id, t.portal_pin
      FROM tenants t
      WHERE LOWER(t.lot_id) = LOWER(?) AND LOWER(t.last_name) = LOWER(?) AND t.is_active = 1
      LIMIT 1
    `).get(lot_id.trim(), last_name.trim());

    if (!tenant) return res.status(401).json({ error: 'Tenant not found' });
    if (tenant.portal_pin) return res.status(400).json({ error: 'PIN already set. Contact management to reset.' });

    const hash = bcrypt.hashSync(String(pin), 10);
    db.prepare("UPDATE tenants SET portal_pin = ?, last_portal_login = datetime('now'), portal_login_count = COALESCE(portal_login_count, 0) + 1 WHERE id = ?").run(hash, tenant.id);

    const token = jwt.sign({ id: tenant.id, lot_id: tenant.lot_id, role: 'tenant', name: `${tenant.first_name} ${tenant.last_name}` }, SECRET, { expiresIn: '2h' });
    res.json({ token, tenant: { id: tenant.id, first_name: tenant.first_name, last_name: tenant.last_name, lot_id: tenant.lot_id } });
  } catch (err) {
    console.error('[portal] setup-pin error:', err.message);
    res.status(500).json({ error: 'Setup failed. Please try again.' });
  }
});

// Middleware: verify tenant JWT
function tenantAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const user = jwt.verify(token, SECRET);
    if (user.role !== 'tenant') return res.status(403).json({ error: 'Tenant access only' });
    req.tenant = user;
    next();
  } catch { res.status(401).json({ error: 'Session expired. Please log in again.' }); }
}

// Get tenant dashboard data
router.get('/me', tenantAuth, (req, res) => {
  try {
    const tenant = db.prepare('SELECT id, first_name, last_name, lot_id, phone, email FROM tenants WHERE id = ?').get(req.tenant.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    let balance = null;
    let accountCredit = 0;
    try {
      // Sum balance_due from unpaid invoices (what they currently owe)
      const owedResult = db.prepare(`
        SELECT COALESCE(SUM(balance_due), 0) as total
        FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0
      `).get(tenant.id);
      const owed = owedResult?.total ?? 0;

      // Get tenant credit balance (overpayments, held credits, etc.)
      const tenantRow = db.prepare('SELECT credit_balance FROM tenants WHERE id = ?').get(tenant.id);
      const creditBal = Number(tenantRow?.credit_balance) || 0;

      // Check for unlinked positive payments (no invoice_id) that weren't held as credit
      // These are payments the admin recorded but didn't link to an invoice or mark as credit
      const unlinkedResult = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM payments WHERE tenant_id = ? AND invoice_id IS NULL
          AND amount > 0
          AND COALESCE(notes,'') NOT LIKE '%Held as tenant credit%'
          AND COALESCE(notes,'') NOT LIKE '%Credit balance refund%'
          AND COALESCE(payment_method,'') != 'Credit'
      `).get(tenant.id);
      const unlinkedCredit = Number(unlinkedResult?.total) || 0;

      accountCredit = Math.round((creditBal + unlinkedCredit) * 100) / 100;
      balance = Math.round((owed - creditBal - unlinkedCredit) * 100) / 100;
    } catch (e) {
      console.error('[CRITICAL] Portal balance query failed:', e.message);
      // balance stays null — frontend will show "unavailable" instead of $0
    }

    let invoices = [];
    try {
      invoices = db.prepare(`
        SELECT id, invoice_number, invoice_date, total_amount, balance_due, status,
          rent_amount, electric_amount, mailbox_fee, misc_fee,
          extra_occupancy_fee, late_fee, refund_amount, refund_description, credit_applied
        FROM invoices WHERE tenant_id = ? AND COALESCE(deleted,0)=0
        ORDER BY invoice_date DESC LIMIT 6
      `).all(tenant.id);
    } catch (e) {
      console.error('[CRITICAL] Portal invoice query failed:', e.message);
      // invoices stays [] — frontend shows empty list rather than crashing
    }

    // Google review banner settings
    var reviewUrl = db.prepare("SELECT value FROM settings WHERE key = 'google_review_url'").get()?.value || 'https://search.google.com/local/writereview?placeid=ChIJgTxw3Pk-P4YRs2t_UMVRVa4';
    var reviewEnabled = db.prepare("SELECT value FROM settings WHERE key = 'review_request_enabled'").get()?.value !== '0';
    var reviewText = db.prepare("SELECT value FROM settings WHERE key = 'review_banner_text'").get()?.value || '';

    res.json({ ...tenant, balance, accountCredit, invoices, reviewUrl, reviewEnabled, reviewText });
  } catch (err) {
    console.error('[CRITICAL] Portal /me endpoint failed:', err.message);
    res.status(500).json({ error: 'temporarily unavailable', balance: null });
  }
});

// Helper: get or create Stripe instance
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Payment system not configured');
  return require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2022-11-15' });
}

// Helper: get or create Stripe Customer for tenant
async function getOrCreateCustomer(tenantId) {
  const stripe = getStripe();
  const tenant = db.prepare('SELECT id, first_name, last_name, email, phone, lot_id, stripe_customer_id FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw new Error('Tenant not found');
  if (tenant.stripe_customer_id) {
    try {
      const cust = await stripe.customers.retrieve(tenant.stripe_customer_id);
      if (!cust.deleted) return cust.id;
    } catch {}
  }
  const cust = await stripe.customers.create({
    name: `${tenant.first_name} ${tenant.last_name}`,
    email: tenant.email || undefined,
    phone: tenant.phone || undefined,
    metadata: { tenant_id: String(tenant.id), lot_id: tenant.lot_id },
  });
  db.prepare('UPDATE tenants SET stripe_customer_id = ? WHERE id = ?').run(cust.id, tenant.id);
  return cust.id;
}

// Invoice detail for payment review (Step 1)
// If ?invoice_number= is provided, returns that single invoice (any status) for receipt detail view
router.get('/invoice-detail', tenantAuth, (req, res) => {
  try {
    if (req.query.invoice_number) {
      const inv = db.prepare(`
        SELECT id, invoice_number, invoice_date, billing_period_start, billing_period_end,
          rent_amount, electric_amount,
          COALESCE(mailbox_fee,0) as mailbox_fee, COALESCE(late_fee,0) as late_fee,
          COALESCE(other_charges,0) as other_charges, other_description,
          COALESCE(misc_fee,0) as misc_fee, misc_description, refund_description,
          COALESCE(extra_occupancy_fee,0) as extra_occupancy_fee,
          COALESCE(credit_applied,0) as credit_applied,
          COALESCE(refund_amount,0) as refund_amount,
          total_amount, amount_paid, balance_due, status,
          COALESCE(late_fee_waived,0) as late_fee_waived
        FROM invoices WHERE tenant_id = ? AND invoice_number = ? AND COALESCE(deleted,0)=0
      `).get(req.tenant.id, req.query.invoice_number);
      return res.json(inv || null);
    }
    const invoices = db.prepare(`
      SELECT id, invoice_number, invoice_date, rent_amount, electric_amount,
        COALESCE(mailbox_fee,0) as mailbox_fee, COALESCE(late_fee,0) as late_fee,
        COALESCE(other_charges,0) as other_charges, other_description,
        COALESCE(misc_fee,0) as misc_fee, misc_description,
        COALESCE(extra_occupancy_fee,0) as extra_occupancy_fee,
        COALESCE(credit_applied,0) as credit_applied,
        COALESCE(refund_amount,0) as refund_amount,
        total_amount, amount_paid, balance_due, status,
        COALESCE(late_fee_waived,0) as late_fee_waived
      FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0
      ORDER BY invoice_date ASC
    `).all(req.tenant.id);
    const totalBalance = invoices.reduce((s, i) => s + (Number(i.balance_due) || 0), 0);
    res.json({ invoices, totalBalance });
  } catch (err) {
    console.error('[portal] invoice-detail error:', err);
    res.status(500).json({ error: 'Could not load invoice details' });
  }
});

// Pay — creates Stripe checkout for the tenant's total balance (new card flow)
router.post('/pay', tenantAuth, async (req, res) => {
  try {
    const balance = db.prepare(`
      SELECT COALESCE(SUM(balance_due), 0) as total
      FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0
    `).get(req.tenant.id);
    const amount = balance?.total || 0;
    if (amount <= 0) return res.status(400).json({ error: 'No balance due' });

    const invoice = db.prepare("SELECT id, invoice_number, lot_id FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0 ORDER BY invoice_date ASC LIMIT 1").get(req.tenant.id);

    const balanceCents = Math.round(amount * 100);
    const feeCents = Math.round(balanceCents * 0.03);

    const stripe = getStripe();
    const customerId = await getOrCreateCustomer(req.tenant.id);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        { price_data: { currency: 'usd', product_data: { name: 'Anahuac RV Park — Balance Due', description: `Lot ${req.tenant.lot_id}` }, unit_amount: balanceCents }, quantity: 1 },
        { price_data: { currency: 'usd', product_data: { name: 'Convenience Fee (3%)' }, unit_amount: feeCents }, quantity: 1 },
      ],
      metadata: { invoice_id: String(invoice?.id || ''), tenant_id: String(req.tenant.id) },
      success_url: `${APP_URL}/portal.html?paid=1`,
      cancel_url: `${APP_URL}/portal.html?cancelled=1`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[portal] pay error:', err);
    res.status(500).json({ error: err.message || 'Payment system error' });
  }
});

// Pay with saved card via PaymentIntent
router.post('/pay-with-card', tenantAuth, async (req, res) => {
  try {
    const { payment_method_id } = req.body || {};
    if (!payment_method_id) return res.status(400).json({ error: 'No card selected' });

    const balance = db.prepare(`
      SELECT COALESCE(SUM(balance_due), 0) as total
      FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0
    `).get(req.tenant.id);
    const amount = balance?.total || 0;
    if (amount <= 0) return res.status(400).json({ error: 'No balance due' });

    const invoice = db.prepare("SELECT id, invoice_number, lot_id FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0 ORDER BY invoice_date ASC LIMIT 1").get(req.tenant.id);

    const balanceCents = Math.round(amount * 100);
    const feeCents = Math.round(balanceCents * 0.03);
    const totalCents = balanceCents + feeCents;

    const stripe = getStripe();
    const customerId = await getOrCreateCustomer(req.tenant.id);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      customer: customerId,
      payment_method: payment_method_id,
      off_session: false,
      confirm: true,
      return_url: `${APP_URL}/portal.html?paid=1`,
      metadata: {
        invoice_id: String(invoice?.id || ''),
        tenant_id: String(req.tenant.id),
        balance_amount: String(amount),
        fee_amount: String((feeCents / 100).toFixed(2)),
      },
      description: `Anahuac RV Park — Lot ${req.tenant.lot_id} — Invoice ${invoice?.invoice_number || 'N/A'}`,
    });

    if (paymentIntent.status === 'succeeded') {
      // Record payment immediately (webhook also handles this as backup)
      recordPaymentFromIntent(paymentIntent, invoice, req.tenant.id, amount);
      res.json({ success: true, status: 'succeeded' });
    } else if (paymentIntent.status === 'requires_action') {
      res.json({ success: false, status: 'requires_action', client_secret: paymentIntent.client_secret });
    } else {
      res.json({ success: false, status: paymentIntent.status, error: 'Payment was not completed' });
    }
  } catch (err) {
    console.error('[portal] pay-with-card error:', err);
    const msg = err.type === 'StripeCardError' ? err.message : 'Payment failed. Please try again or use a different card.';
    res.status(400).json({ error: msg });
  }
});

// Helper: record payment from a PaymentIntent (for saved-card flow)
function recordPaymentFromIntent(pi, invoice, tenantId, balanceAmount) {
  if (!invoice) return;
  const already = db.prepare("SELECT id FROM payments WHERE reference_number = ? LIMIT 1").get(pi.id);
  if (already) return;

  const today = new Date().toISOString().split('T')[0];
  const paymentAmount = Number(balanceAmount) || 0;
  db.prepare(`INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes)
    VALUES (?, ?, ?, ?, 'Credit Card', ?, ?)`)
    .run(tenantId, invoice.id, today, paymentAmount, pi.id,
      `Stripe saved card, charged $${(pi.amount / 100).toFixed(2)} (incl. 3% convenience fee)`);

  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
  if (inv) {
    const newPaid = (Number(inv.amount_paid) || 0) + paymentAmount;
    const newBalance = (Number(inv.total_amount) || 0) - newPaid;
    const newStatus = newBalance <= 0.005 ? 'paid' : 'partial';
    db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
      .run(newPaid, Math.max(0, newBalance), newStatus, inv.id);

    if (newBalance <= 0.005) {
      const unpaid = db.prepare("SELECT COUNT(*) as cnt FROM invoices WHERE tenant_id = ? AND balance_due > 0.005 AND status IN ('pending','partial') AND COALESCE(deleted,0) = 0").get(tenantId);
      if (!unpaid || unpaid.cnt === 0) {
        db.prepare('UPDATE tenants SET eviction_warning = 0, eviction_notified = 0, eviction_paused = 0, eviction_pause_note = NULL WHERE id = ?').run(tenantId);
      }
    }

    // Send confirmation email + SMS (non-blocking)
    try {
      const tenant = db.prepare('SELECT first_name, last_name, email, phone, lot_id FROM tenants WHERE id = ?').get(tenantId);
      const remaining = Math.max(0, newBalance).toFixed(2);
      if (tenant?.phone) {
        sendSms(tenant.phone, `Anahuac RV Park: Payment of $${paymentAmount.toFixed(2)} received for Invoice ${inv.invoice_number}. Thank you! Balance: $${remaining}. Questions? 409-267-6603`).catch(() => {});
      }
    } catch {}
  }
}

// Saved cards — list
router.get('/saved-cards', tenantAuth, async (req, res) => {
  try {
    const tenant = db.prepare('SELECT stripe_customer_id FROM tenants WHERE id = ?').get(req.tenant.id);
    if (!tenant?.stripe_customer_id) return res.json({ cards: [], default_pm: null });

    const stripe = getStripe();
    const methods = await stripe.paymentMethods.list({ customer: tenant.stripe_customer_id, type: 'card' });
    const customer = await stripe.customers.retrieve(tenant.stripe_customer_id);
    const defaultPm = customer.invoice_settings?.default_payment_method || null;

    const cards = methods.data.map(pm => ({
      id: pm.id,
      brand: pm.card.brand,
      last4: pm.card.last4,
      exp_month: pm.card.exp_month,
      exp_year: pm.card.exp_year,
      is_default: pm.id === defaultPm,
    }));
    res.json({ cards, default_pm: defaultPm });
  } catch (err) {
    console.error('[portal] saved-cards error:', err);
    res.json({ cards: [], default_pm: null });
  }
});

// Save card — create SetupIntent for Stripe Elements
router.post('/save-card', tenantAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const customerId = await getOrCreateCustomer(req.tenant.id);
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
    res.json({ client_secret: setupIntent.client_secret });
  } catch (err) {
    console.error('[portal] save-card error:', err);
    res.status(500).json({ error: 'Could not start card setup' });
  }
});

// Remove saved card
router.post('/remove-card', tenantAuth, async (req, res) => {
  try {
    const { payment_method_id } = req.body || {};
    if (!payment_method_id) return res.status(400).json({ error: 'No card specified' });
    const stripe = getStripe();
    await stripe.paymentMethods.detach(payment_method_id);
    res.json({ success: true });
  } catch (err) {
    console.error('[portal] remove-card error:', err);
    res.status(500).json({ error: 'Could not remove card' });
  }
});

// Set default card
router.post('/default-card', tenantAuth, async (req, res) => {
  try {
    const { payment_method_id } = req.body || {};
    if (!payment_method_id) return res.status(400).json({ error: 'No card specified' });
    const tenant = db.prepare('SELECT stripe_customer_id FROM tenants WHERE id = ?').get(req.tenant.id);
    if (!tenant?.stripe_customer_id) return res.status(400).json({ error: 'No customer record' });
    const stripe = getStripe();
    await stripe.customers.update(tenant.stripe_customer_id, {
      invoice_settings: { default_payment_method: payment_method_id },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[portal] default-card error:', err);
    res.status(500).json({ error: 'Could not set default card' });
  }
});

// Send message to management
router.post('/message', tenantAuth, (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

    db.prepare('INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 0)')
      .run(req.tenant.id, 'Portal Message', message.trim(), 'portal');

    // Forward to manager via SMS
    try {
      const mgrPhone = getManagerPhone();
      if (mgrPhone) {
        sendSms(mgrPhone, `Portal message from ${req.tenant.name} (Lot ${req.tenant.lot_id}): ${message.trim()}`).catch(e => console.error('[portal] mgr SMS failed:', e.message));
      }
    } catch {}

    res.json({ success: true });
  } catch (err) {
    console.error('[portal] message error:', err.message);
    res.status(500).json({ error: 'Could not send message' });
  }
});

// Payment history for the logged-in tenant
router.get('/payments', tenantAuth, (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference_number, p.notes,
        i.invoice_number, i.total_amount, i.balance_due, i.status as invoice_status,
        t.first_name, t.last_name, t.lot_id
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
      LEFT JOIN tenants t ON p.tenant_id = t.id
      WHERE p.tenant_id = ?
      ORDER BY p.payment_date DESC, p.id DESC
    `).all(req.tenant.id);
    res.json(payments);
  } catch (err) {
    console.error('[CRITICAL] Portal payment history query failed:', err.message);
    res.status(500).json({ error: 'Could not load payment history' });
  }
});

// Birthday message for the logged-in tenant (most recent, within last 3 days)
router.get('/birthday-message', tenantAuth, (req, res) => {
  try {
    var msg = db.prepare(`
      SELECT id, subject, body, sent_date FROM messages
      WHERE tenant_id = ? AND message_type = 'birthday'
        AND sent_date >= datetime('now', '-3 days')
      ORDER BY sent_date DESC LIMIT 1
    `).get(req.tenant.id);
    res.json(msg || null);
  } catch { res.json(null); }
});

// Auth middleware that also accepts token from query string (for direct links / window.open)
function tenantAuthFlexible(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const user = jwt.verify(token, SECRET);
    if (user.role !== 'tenant') return res.status(403).json({ error: 'Tenant access only' });
    req.tenant = user;
    next();
  } catch { res.status(401).json({ error: 'Session expired. Please log in again.' }); }
}

// Server-side PDF receipt generation
router.get('/receipt-pdf', tenantAuthFlexible, (req, res) => {
  try {
    const paymentId = parseInt(req.query.payment_id);
    if (!paymentId) return res.status(400).json({ error: 'payment_id required' });

    const payment = db.prepare(`
      SELECT p.*, t.first_name, t.last_name, t.lot_id, t.credit_balance
      FROM payments p JOIN tenants t ON p.tenant_id = t.id
      WHERE p.id = ? AND p.tenant_id = ?
    `).get(paymentId, req.tenant.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    // Fetch linked invoice
    var invoice = null;
    if (payment.invoice_id) {
      invoice = db.prepare(`
        SELECT id, invoice_number, invoice_date, billing_period_start, billing_period_end,
          rent_amount, electric_amount, COALESCE(mailbox_fee,0) as mailbox_fee,
          COALESCE(late_fee,0) as late_fee, COALESCE(late_fee_waived,0) as late_fee_waived,
          COALESCE(other_charges,0) as other_charges, other_description,
          COALESCE(misc_fee,0) as misc_fee, misc_description,
          COALESCE(extra_occupancy_fee,0) as extra_occupancy_fee,
          COALESCE(credit_applied,0) as credit_applied,
          COALESCE(refund_amount,0) as refund_amount, refund_description,
          total_amount, amount_paid, balance_due, status
        FROM invoices WHERE id = ? AND tenant_id = ?
      `).get(payment.invoice_id, req.tenant.id);
    }

    const invNum = invoice?.invoice_number || payment.reference_number || 'Payment';
    const dateStr = (payment.payment_date || '').replace(/\//g, '-');
    const filename = 'Receipt-' + invNum + '-' + dateStr + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    doc.pipe(res);

    // Helper: draw a row with left label + right value
    const leftX = 50, rightX = 350, colW = 200;
    var y;

    // ─── PARK HEADER ───
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a5c32')
      .text('Anahuac RV Park', { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#666666')
      .text('1003 Davis Ave, Anahuac, TX 77514', { align: 'center' })
      .text('Phone: 409-267-6603', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).lineWidth(2).strokeColor('#1a5c32').stroke();
    doc.moveDown(1);

    // ─── TITLE ───
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a5c32')
      .text('PAYMENT RECEIPT', { align: 'center' });
    doc.moveDown(1);

    // ─── PAYMENT INFO ───
    y = doc.y;
    var addInfoRow = function(label, value) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#555555').text(label, leftX, y);
      doc.font('Helvetica').fontSize(10).fillColor('#000000').text(value || 'N/A', rightX, y, { align: 'right', width: colW });
      y += 20;
    };
    addInfoRow('Date:', payment.payment_date || '');
    addInfoRow('Guest:', (payment.first_name || '') + ' ' + (payment.last_name || ''));
    addInfoRow('Lot / Site:', payment.lot_id || '');
    addInfoRow('Invoice:', invNum);
    var methodLabel = (payment.payment_method || 'N/A');
    methodLabel = methodLabel.charAt(0).toUpperCase() + methodLabel.slice(1);
    addInfoRow('Payment Method:', methodLabel);
    doc.y = y + 5;

    // ─── LINE ITEMS ───
    if (invoice) {
      doc.moveTo(50, doc.y).lineTo(562, doc.y).lineWidth(1).strokeColor('#cccccc').stroke();
      doc.moveDown(0.6);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a5c32').text('INVOICE BREAKDOWN');
      var billingPeriod = '';
      if (invoice.billing_period_start) {
        try {
          var bd = new Date(invoice.billing_period_start + 'T00:00:00');
          billingPeriod = ' — ' + bd.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        } catch {}
      }
      if (billingPeriod) doc.fontSize(9).font('Helvetica').fillColor('#666666').text(billingPeriod);
      doc.moveDown(0.4);
      y = doc.y;

      var addLine = function(label, amt, color) {
        if (Math.abs(amt) < 0.005) return;
        doc.font('Helvetica').fontSize(10).fillColor(color || '#000000').text(label, leftX, y);
        var prefix = amt < 0 ? '-$' : '$';
        doc.text(prefix + Math.abs(amt).toFixed(2), rightX, y, { align: 'right', width: colW });
        y += 18;
      };
      addLine('Lot Rent', Number(invoice.rent_amount) || 0);
      addLine('Electric', Number(invoice.electric_amount) || 0);
      if (invoice.mailbox_fee > 0.005) addLine('Mailbox Fee', invoice.mailbox_fee);
      if (invoice.misc_fee > 0.005) addLine(invoice.misc_description || 'Misc Fee', invoice.misc_fee);
      if (invoice.extra_occupancy_fee > 0.005) addLine('Extra Occupancy', invoice.extra_occupancy_fee);
      if (invoice.other_charges > 0.005) addLine(invoice.other_description || 'Other Charges', invoice.other_charges);
      if (invoice.late_fee > 0.005 && !invoice.late_fee_waived) addLine('Late Fee', invoice.late_fee, '#dc2626');
      if (invoice.refund_amount > 0.005) addLine(invoice.refund_description || 'Credit/Adjustment', -(invoice.refund_amount), '#16a34a');
      if (invoice.credit_applied > 0.005) addLine('Credit Applied (prev. month)', -(invoice.credit_applied), '#16a34a');

      doc.y = y + 4;
      doc.moveTo(50, doc.y).lineTo(562, doc.y).lineWidth(1).strokeColor('#cccccc').stroke();
      doc.moveDown(0.4);

      y = doc.y;
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Total Due', leftX, y);
      doc.text('$' + (Number(invoice.total_amount) || 0).toFixed(2), rightX, y, { align: 'right', width: colW });
      doc.y = y + 24;
    }

    // ─── AMOUNT PAID ───
    doc.moveTo(50, doc.y).lineTo(562, doc.y).lineWidth(2).strokeColor('#1a5c32').stroke();
    doc.moveDown(0.5);
    y = doc.y;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#16a34a').text('Amount Paid', leftX, y);
    doc.text('$' + Number(payment.amount).toFixed(2), rightX, y, { align: 'right', width: colW });
    y += 24;

    // ─── OVERPAYMENT / BALANCE ───
    if (invoice) {
      var total = Number(invoice.total_amount) || 0;
      var paidAmt = Number(payment.amount) || 0;
      if (paidAmt > total + 0.005) {
        var overpay = +(paidAmt - total).toFixed(2);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#16a34a').text('Overpayment → Credit', leftX, y);
        doc.text('+$' + overpay.toFixed(2), rightX, y, { align: 'right', width: colW });
        y += 20;
        // Forward month
        try {
          var bd2 = new Date((invoice.billing_period_start || invoice.invoice_date) + 'T00:00:00');
          bd2.setMonth(bd2.getMonth() + 1);
          var fwdMonth = bd2.toLocaleString('en-US', { month: 'long', year: 'numeric' });
          doc.fontSize(10).font('Helvetica').fillColor('#16a34a')
            .text('Credit of $' + overpay.toFixed(2) + ' will apply to ' + fwdMonth + ' invoice', 50, y, { align: 'center', width: 512 });
          y += 22;
        } catch {}
      } else if (Number(invoice.balance_due) > 0.01) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#dc2626').text('Remaining Balance', leftX, y);
        doc.text('$' + Number(invoice.balance_due).toFixed(2), rightX, y, { align: 'right', width: colW });
        y += 22;
      }
    }

    // ─── TENANT CREDIT BALANCE ───
    var tenantCredit = Number(payment.credit_balance) || 0;
    if (tenantCredit > 0.01) {
      doc.y = y + 8;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#16a34a')
        .text('Account Credit Balance: $' + tenantCredit.toFixed(2), { align: 'center' });
      doc.moveDown(0.5);
    } else {
      doc.y = y + 10;
    }

    // ─── THANK YOU ───
    doc.moveDown(1);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a5c32')
      .text('Thank you for your payment!', { align: 'center' });

    // ─── FOOTER ───
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).lineWidth(1).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).font('Helvetica').fillColor('#999999')
      .text('Anahuac RV Park · 1003 Davis Ave, Anahuac, TX 77514 · 409-267-6603', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[portal] receipt-pdf error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not generate receipt' });
  }
});

// ── Community Activity Feed (for guest portal banner) ──
router.get('/community-activity', tenantAuth, (req, res) => {
  try {
    var items = [];

    // 1. Catch posts
    try {
      db.prepare(`SELECT p.id, p.species, p.location, p.created_at as ts,
        COALESCE(t.first_name, 'Visitor') as who, COALESCE(t.lot_id, '') as lot, p.post_type
        FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
        ORDER BY p.created_at DESC LIMIT 10`).all().forEach(function(c) {
        items.push({ type: 'catch', icon: c.post_type === 'fishing' ? '🎣' : '🦆',
          text: c.who + (c.lot ? ' (' + c.lot + ')' : '') + ' caught ' + (c.species || 'something') + (c.location ? ' at ' + c.location : ''),
          ts: c.ts, post_id: c.id, section: 'hunting-fishing' });
      });
    } catch {}

    // 2. Catch comments
    try {
      db.prepare(`SELECT c.comment, c.created_at as ts, c.post_id, c.is_management,
        CASE WHEN COALESCE(c.is_management,0)=1 THEN 'Park Management'
             ELSE COALESCE(c.author_name, t.first_name, 'Visitor') END as who,
        p.species FROM catch_comments c LEFT JOIN tenants t ON c.tenant_id = t.id
        LEFT JOIN hunting_fishing_posts p ON c.post_id = p.id
        ORDER BY c.created_at DESC LIMIT 10`).all().forEach(function(c) {
        items.push({ type: 'comment', icon: '💬',
          text: c.who + ' commented on ' + (c.species || 'a catch'),
          ts: c.ts, post_id: c.post_id, section: 'hunting-fishing' });
      });
    } catch {}

    // 3. Catch reactions (grouped)
    try {
      db.prepare(`SELECT p.id as post_id, p.species, COUNT(*) as cnt, MAX(r.created_at) as ts
        FROM catch_reactions r JOIN hunting_fishing_posts p ON r.post_id = p.id
        WHERE r.created_at > datetime('now', '-48 hours')
        GROUP BY p.id ORDER BY ts DESC LIMIT 5`).all().forEach(function(r) {
        items.push({ type: 'reaction', icon: '❤️',
          text: r.cnt + ' reaction' + (r.cnt > 1 ? 's' : '') + ' on ' + (r.species || 'a catch'),
          ts: r.ts, post_id: r.post_id, section: 'hunting-fishing' });
      });
    } catch {}

    // 4. Community posts (approved only)
    try {
      db.prepare(`SELECT p.id, p.title, p.submitted_at as ts,
        CASE WHEN p.tenant_id IS NULL THEN 'Park Management' ELSE t.first_name END as who,
        COALESCE(t.lot_id, '') as lot
        FROM community_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
        WHERE p.status = 'approved' ORDER BY p.submitted_at DESC LIMIT 10`).all().forEach(function(c) {
        items.push({ type: 'community', icon: '📢',
          text: c.who + (c.lot ? ' (' + c.lot + ')' : '') + ' posted: ' + (c.title || '(untitled)').slice(0, 50),
          ts: c.ts, section: 'community' });
      });
    } catch {}

    // 5. Community replies
    try {
      db.prepare(`SELECT r.author_name as who, r.created_at as ts, r.is_management, p.title
        FROM community_replies r JOIN community_posts p ON r.post_id = p.id
        ORDER BY r.created_at DESC LIMIT 8`).all().forEach(function(r) {
        var name = r.is_management ? 'Park Management' : (r.who || 'Someone');
        items.push({ type: 'reply', icon: '💬',
          text: name + ' replied to "' + (r.title || 'a post').slice(0, 40) + '"',
          ts: r.ts, section: 'community' });
      });
    } catch {}

    // 6. Bird sightings
    try {
      db.prepare(`SELECT b.bird_name, b.location, b.rarity, b.created_at as ts,
        COALESCE(t.first_name, 'Visitor') as who
        FROM bird_sightings b LEFT JOIN tenants t ON b.tenant_id = t.id
        ORDER BY b.created_at DESC LIMIT 5`).all().forEach(function(b) {
        items.push({ type: 'birding', icon: '🐦',
          text: b.who + ' spotted ' + (b.bird_name || 'a bird') + (b.location ? ' at ' + b.location : '') + (b.rarity && b.rarity !== 'Common' ? ' (' + b.rarity + ')' : ''),
          ts: b.ts, section: 'birding' });
      });
    } catch {}

    // 7. Lost & found
    try {
      db.prepare(`SELECT l.type, l.pet_type, l.pet_name, l.status, l.created_at as ts,
        COALESCE(t.first_name, 'Someone') as who
        FROM lost_found_pets l LEFT JOIN tenants t ON l.tenant_id = t.id
        WHERE l.status = 'active' ORDER BY l.created_at DESC LIMIT 5`).all().forEach(function(l) {
        items.push({ type: 'lost-found', icon: '📦',
          text: l.who + ' reported ' + l.type + ' ' + (l.pet_type || 'pet') + (l.pet_name ? ' "' + l.pet_name + '"' : ''),
          ts: l.ts, section: 'lost-found' });
      });
    } catch {}

    // 8. General chat posts
    try {
      db.prepare(`SELECT g.message, g.category, g.created_at as ts,
        CASE WHEN g.is_management = 1 THEN 'Park Management' ELSE COALESCE(t.first_name, 'Someone') END as who
        FROM general_chat_posts g LEFT JOIN tenants t ON g.tenant_id = t.id
        ORDER BY g.created_at DESC LIMIT 5`).all().forEach(function(g) {
        var preview = (g.message || '').substring(0, 60) + (g.message && g.message.length > 60 ? '...' : '');
        items.push({ type: 'chat', icon: '💬',
          text: g.who + ': ' + preview,
          ts: g.ts, section: 'general-chat' });
      });
    } catch {}

    // 9. Garden posts
    try {
      db.prepare(`SELECT g.plant_name, g.caption, g.created_at as ts,
        CASE WHEN g.is_management = 1 THEN 'Park Management' ELSE COALESCE(t.first_name, 'Someone') END as who
        FROM garden_posts g LEFT JOIN tenants t ON g.tenant_id = t.id
        ORDER BY g.created_at DESC LIMIT 5`).all().forEach(function(g) {
        items.push({ type: 'garden', icon: '🌱',
          text: g.who + ' shared ' + (g.plant_name || 'a plant') + (g.caption ? ': ' + g.caption.substring(0, 40) : ''),
          ts: g.ts, section: 'garden' });
      });
    } catch {}

    items.sort(function(a, b) { return (b.ts || '').localeCompare(a.ts || ''); });
    res.json({ items: items.slice(0, 15) });
  } catch (err) {
    console.error('[portal] community-activity error:', err);
    res.json({ items: [] });
  }
});

// ── Push Notifications ──

// Public: get VAPID public key
router.get('/push/vapid-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

// Subscribe to push notifications
router.post('/push/subscribe', tenantAuth, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
  try {
    // Upsert — update keys if endpoint already exists
    const existing = db.prepare('SELECT id FROM push_subscriptions WHERE tenant_id = ? AND endpoint = ?').get(req.tenant.id, endpoint);
    if (existing) {
      db.prepare('UPDATE push_subscriptions SET p256dh_key = ?, auth_key = ?, user_agent = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(keys.p256dh, keys.auth, req.headers['user-agent'] || '', existing.id);
    } else {
      db.prepare('INSERT INTO push_subscriptions (tenant_id, is_admin, endpoint, p256dh_key, auth_key, user_agent, device_label) VALUES (?,0,?,?,?,?,?)')
        .run(req.tenant.id, endpoint, keys.p256dh, keys.auth, req.headers['user-agent'] || '', req.body.device_label || '');
    }
    // Ensure notification preferences exist
    try {
      db.prepare('INSERT OR IGNORE INTO notification_preferences (tenant_id) VALUES (?)').run(req.tenant.id);
    } catch {}
    res.json({ success: true });
  } catch (e) {
    console.error('[push] subscribe error:', e.message);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// Unsubscribe
router.post('/push/unsubscribe', tenantAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Endpoint required' });
  try {
    db.prepare('DELETE FROM push_subscriptions WHERE tenant_id = ? AND endpoint = ?').run(req.tenant.id, endpoint);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Get unread notification count
router.get('/notifications/unread-count', tenantAuth, (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE tenant_id = ? AND is_admin = 0 AND is_read = 0').get(req.tenant.id)?.c || 0;
    res.json({ count });
  } catch { res.json({ count: 0 }); }
});

// Get notification history
router.get('/notifications', tenantAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM notifications WHERE tenant_id = ? AND is_admin = 0 ORDER BY created_at DESC LIMIT 50').all(req.tenant.id);
    res.json(rows || []);
  } catch { res.json([]); }
});

// Mark notifications as read
router.post('/notifications/mark-read', tenantAuth, (req, res) => {
  const { notification_ids } = req.body || {};
  try {
    if (notification_ids && notification_ids.length) {
      const placeholders = notification_ids.map(() => '?').join(',');
      db.prepare(`UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id IN (${placeholders})`).run(req.tenant.id, ...notification_ids);
    } else {
      // Mark all as read
      db.prepare('UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND is_read = 0').run(req.tenant.id);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Get notification preferences
router.get('/notifications/preferences', tenantAuth, (req, res) => {
  try {
    let prefs = db.prepare('SELECT * FROM notification_preferences WHERE tenant_id = ?').get(req.tenant.id);
    if (!prefs) {
      db.prepare('INSERT OR IGNORE INTO notification_preferences (tenant_id) VALUES (?)').run(req.tenant.id);
      prefs = db.prepare('SELECT * FROM notification_preferences WHERE tenant_id = ?').get(req.tenant.id);
    }
    res.json(prefs || {});
  } catch { res.json({}); }
});

// Update notification preferences
router.put('/notifications/preferences', tenantAuth, (req, res) => {
  const b = req.body || {};
  try {
    db.prepare('INSERT OR IGNORE INTO notification_preferences (tenant_id) VALUES (?)').run(req.tenant.id);
    db.prepare(`UPDATE notification_preferences SET
      enabled = ?, invoices = ?, payments = ?, community = ?, maintenance = ?,
      announcements = ?, weather_alerts = ?, quiet_hours_enabled = ?,
      quiet_start_hour = ?, quiet_end_hour = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?`).run(
      b.enabled !== false ? 1 : 0,
      b.invoices !== false ? 1 : 0,
      b.payments !== false ? 1 : 0,
      b.community !== false ? 1 : 0,
      b.maintenance !== false ? 1 : 0,
      b.announcements !== false ? 1 : 0,
      b.weather_alerts !== false ? 1 : 0,
      b.quiet_hours_enabled !== false ? 1 : 0,
      parseInt(b.quiet_start_hour) || 22,
      parseInt(b.quiet_end_hour) || 7,
      req.tenant.id
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// Get devices (subscriptions) for this tenant
router.get('/push/devices', tenantAuth, (req, res) => {
  try {
    const devices = db.prepare('SELECT id, device_label, user_agent, created_at, last_used_at FROM push_subscriptions WHERE tenant_id = ? AND is_admin = 0').all(req.tenant.id);
    res.json(devices || []);
  } catch { res.json([]); }
});

// Remove a device
router.delete('/push/devices/:id', tenantAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND tenant_id = ?').run(parseInt(req.params.id), req.tenant.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to remove device' }); }
});

// ── Quarter Requests (Tenant) ──
const pushService = require('../services/push-notifications');

// Submit a quarter request
router.post('/quarter-requests', tenantAuth, (req, res) => {
  const b = req.body || {};
  const amount = parseFloat(b.amount);
  if (!amount || amount <= 0 || amount > 200) return res.status(400).json({ error: 'Invalid amount (max $200)' });
  try {
    const result = db.prepare(`INSERT INTO quarter_requests (tenant_id, amount, when_needed, preferred_time, tenant_note)
      VALUES (?,?,?,?,?)`).run(
      req.tenant.id, amount, b.when_needed || 'asap', b.preferred_time || '', (b.tenant_note || '').substring(0, 200)
    );
    // Notify admin
    const tenant = db.prepare('SELECT first_name, last_name, lot_id FROM tenants WHERE id = ?').get(req.tenant.id);
    const name = tenant ? tenant.first_name + ' ' + tenant.last_name : 'Tenant';
    const lot = tenant?.lot_id || '?';
    try { pushService.notifyAdmin({ type: 'quarters', title: '\ud83e\ude99 Quarter Request from ' + name + ' (Lot ' + lot + ')', body: '$' + amount.toFixed(0) + ' \u2014 ' + (b.when_needed === 'asap' ? 'ASAP' : b.preferred_time || b.when_needed), url: '/', priority: 'normal' }); } catch {}
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// List my quarter requests
router.get('/quarter-requests', tenantAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM quarter_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20').all(req.tenant.id);
    res.json(rows || []);
  } catch { res.json([]); }
});

// Get single request with messages
router.get('/quarter-requests/:id', tenantAuth, (req, res) => {
  try {
    const qr = db.prepare('SELECT * FROM quarter_requests WHERE id = ? AND tenant_id = ?').get(parseInt(req.params.id), req.tenant.id);
    if (!qr) return res.status(404).json({ error: 'Not found' });
    const messages = db.prepare('SELECT * FROM quarter_request_messages WHERE request_id = ? ORDER BY created_at ASC').all(qr.id);
    res.json({ ...qr, messages });
  } catch { res.status(500).json({ error: 'Failed to load request' }); }
});

// Cancel my request
router.post('/quarter-requests/:id/cancel', tenantAuth, (req, res) => {
  try {
    const qr = db.prepare('SELECT * FROM quarter_requests WHERE id = ? AND tenant_id = ?').get(parseInt(req.params.id), req.tenant.id);
    if (!qr) return res.status(404).json({ error: 'Not found' });
    if (qr.status === 'completed') return res.status(400).json({ error: 'Cannot cancel a completed request' });
    db.prepare('UPDATE quarter_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('cancelled', qr.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to cancel' }); }
});

// Tenant sends a message on a request thread
router.post('/quarter-requests/:id/messages', tenantAuth, (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
  try {
    const qr = db.prepare('SELECT * FROM quarter_requests WHERE id = ? AND tenant_id = ?').get(parseInt(req.params.id), req.tenant.id);
    if (!qr) return res.status(404).json({ error: 'Not found' });
    const tenant = db.prepare('SELECT first_name, last_name FROM tenants WHERE id = ?').get(req.tenant.id);
    const name = tenant ? tenant.first_name + ' ' + tenant.last_name : 'Tenant';
    db.prepare('INSERT INTO quarter_request_messages (request_id, sender_type, sender_name, message) VALUES (?,?,?,?)').run(
      qr.id, 'tenant', name, message.trim().substring(0, 500)
    );
    try { pushService.notifyAdmin({ type: 'quarters', title: '\ud83e\ude99 Reply from ' + name, body: message.trim().substring(0, 100), url: '/', priority: 'normal' }); } catch {}
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to send message' }); }
});

module.exports = router;
