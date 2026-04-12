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

// Track failed PIN attempts per tenant (in-memory, resets on restart)
const _failedAttempts = {};

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

  // Check lockout
  const key = 'tenant_' + tenant.id;
  if ((_failedAttempts[key] || 0) >= 3) {
    return res.status(429).json({ error: 'Too many attempts. Please contact management.' });
  }

  // If no PIN set, tell frontend to show setup screen
  if (!tenant.portal_pin) {
    return res.json({ needs_pin_setup: true, tenant_id: tenant.id, lot_id: tenant.lot_id, first_name: tenant.first_name, last_name: tenant.last_name });
  }

  // PIN is set — require it
  if (!pin) return res.status(400).json({ error: 'PIN is required', needs_pin: true });

  if (!bcrypt.compareSync(String(pin), tenant.portal_pin)) {
    _failedAttempts[key] = (_failedAttempts[key] || 0) + 1;
    const remaining = 3 - _failedAttempts[key];
    if (remaining <= 0) return res.status(429).json({ error: 'Too many attempts. Please contact management.' });
    return res.status(401).json({ error: `Incorrect PIN. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`, needs_pin: true });
  }

  // Success — clear attempts
  delete _failedAttempts[key];
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
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const origin = APP_URL;

    stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: undefined,
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

module.exports = router;
