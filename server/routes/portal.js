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
  db.prepare('UPDATE tenants SET portal_pin = ? WHERE id = ?').run(hash, tenant.id);

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
  const tenant = db.prepare('SELECT id, first_name, last_name, lot_id, phone, email FROM tenants WHERE id = ?').get(req.tenant.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const balance = db.prepare(`
    SELECT COALESCE(SUM(balance_due), 0) as total
    FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0
  `).get(tenant.id);

  const invoices = db.prepare(`
    SELECT id, invoice_number, invoice_date, total_amount, balance_due, status
    FROM invoices WHERE tenant_id = ? AND COALESCE(deleted,0)=0
    ORDER BY invoice_date DESC LIMIT 6
  `).all(tenant.id);

  res.json({ ...tenant, balance: balance?.total || 0, invoices });
});

// Pay — creates Stripe checkout for the tenant's total balance
router.post('/pay', tenantAuth, (req, res) => {
  try {
    const balance = db.prepare(`
      SELECT COALESCE(SUM(balance_due), 0) as total
      FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0
    `).get(req.tenant.id);
    const amount = balance?.total || 0;
    if (amount <= 0) return res.status(400).json({ error: 'No balance due' });

    // Find the first unpaid invoice to link the payment to
    const invoice = db.prepare("SELECT id, invoice_number, lot_id FROM invoices WHERE tenant_id = ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0 ORDER BY invoice_date ASC LIMIT 1").get(req.tenant.id);

    const balanceCents = Math.round(amount * 100);
    const feeCents = Math.round(balanceCents * 0.03);

    if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Payment system not configured' });
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2022-11-15',
    });
    const origin = APP_URL;

    stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        { price_data: { currency: 'usd', product_data: { name: `Anahuac RV Park — Balance Due`, description: `Lot ${req.tenant.lot_id}` }, unit_amount: balanceCents }, quantity: 1 },
        { price_data: { currency: 'usd', product_data: { name: 'Convenience Fee (3%)' }, unit_amount: feeCents }, quantity: 1 },
      ],
      metadata: { invoice_id: String(invoice?.id || ''), tenant_id: String(req.tenant.id) },
      success_url: `${origin}/portal.html?paid=1`,
      cancel_url: `${origin}/portal.html?cancelled=1`,
    }).then(session => {
      res.json({ url: session.url });
    }).catch(err => {
      console.error('[portal] stripe error:', err);
      res.status(500).json({ error: 'Payment system error' });
    });
  } catch (err) {
    console.error('[portal] pay error:', err);
    res.status(500).json({ error: 'Internal server error' });
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
  const payments = db.prepare(`
    SELECT p.id, p.payment_date, p.amount, p.payment_method, p.reference_number, p.notes,
      i.invoice_number, i.total_amount, i.balance_due, i.status as invoice_status
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.tenant_id = ?
    ORDER BY p.payment_date DESC, p.id DESC
  `).all(req.tenant.id);
  res.json(payments);
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
