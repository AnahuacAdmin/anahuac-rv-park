/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
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
    try {
      const result = db.prepare(`
        SELECT COALESCE(SUM(balance_due), 0) as total
        FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0
      `).get(tenant.id);
      balance = result?.total ?? 0;
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

    res.json({ ...tenant, balance, invoices });
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
router.get('/invoice-detail', tenantAuth, (req, res) => {
  try {
    const invoices = db.prepare(`
      SELECT id, invoice_number, invoice_date, rent_amount, electric_amount,
        COALESCE(mailbox_fee,0) as mailbox_fee, COALESCE(late_fee,0) as late_fee,
        COALESCE(other_charges,0) as other_charges, other_description,
        COALESCE(misc_fee,0) as misc_fee, misc_description,
        COALESCE(extra_occupancy_fee,0) as extra_occupancy_fee,
        COALESCE(credit_applied,0) as credit_applied,
        COALESCE(refund_amount,0) as refund_amount,
        total_amount, amount_paid, balance_due, status
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
});

// Payment history for the logged-in tenant
router.get('/payments', tenantAuth, (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference_number, p.notes,
        i.invoice_number, i.total_amount, i.balance_due, i.status as invoice_status
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
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

module.exports = router;
