/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Railway / load balancers) so rate limiter sees real client IPs
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // SPA inline scripts; tighten later if desired
}));

// CORS — restrict to allowed origin(s)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // allow same-origin / curl (no Origin header) and whitelisted origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Stripe webhook MUST be registered before express.json so it receives the
// raw request body for signature verification.
require('./stripe-webhook').registerStripeWebhook(app);

// Twilio incoming SMS webhook — public, uses URL-encoded body, registered before JSON parser.
app.use('/api/twilio/incoming-sms', require('./routes/twilio-webhook'));

app.use(express.json({ limit: '5mb' })); // 5mb to allow base64 PDF attachments for emailed invoices
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limit login attempts to prevent brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/recover', loginLimiter);

const portalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});
app.use('/api/portal/login', portalLimiter);
app.use('/api/portal/setup-pin', portalLimiter);

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests. Please try again later.' },
});
app.use('/api/payments/create-checkout-session', paymentLimiter);

// Health check (used by Railway) — verifies DB is loaded.
let dbReady = false;
function healthHandler(req, res) {
  if (!dbReady) return res.status(503).json({ status: 'starting' });
  res.status(200).json({ status: 'ok' });
}
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Tenant portal routes (public login + tenant-authenticated endpoints)
app.use('/api/portal', require('./routes/portal'));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
const invoicesRouter = require('./routes/invoices');
app.use('/api/lots', require('./routes/lots'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/meters', require('./routes/meters'));
app.use('/api/invoices', invoicesRouter);
app.use('/api/payments', require('./routes/payments'));
app.use('/api/checkins', require('./routes/checkins'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/electric', require('./routes/electric'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/health', require('./routes/health'));
app.use('/api/search', require('./routes/search'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/settings', require('./routes/settings'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Daily late fee check at midnight (server local time).
// Runs once on a setTimeout aligned to the next midnight, then every 24h.
function scheduleDailyLateFeeCheck() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0); // 00:05 to be safe
  const msUntil = nextMidnight - now;
  setTimeout(function tick() {
    try {
      const summary = invoicesRouter.runLateFeeCheck();
      console.log('[late-fees] daily check:', summary);
    } catch (err) {
      console.error('[late-fees] daily check failed:', err);
    }
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, msUntil);
  console.log(`[late-fees] daily check scheduled in ${Math.round(msUntil / 60000)} minutes`);
}

// Initialize database THEN start listening.
initializeDatabase()
  .then(() => {
    dbReady = true;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Anahuac RV Park Management running on 0.0.0.0:${PORT}`);
      scheduleDailyLateFeeCheck();
    });
  })
  .catch((err) => {
    console.error('FATAL: Database initialization failed:', err);
    process.exit(1);
  });
