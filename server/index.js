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

// Initialize database
initializeDatabase();

// Health check (used by Railway)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
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

app.listen(PORT, () => {
  console.log(`Anahuac RV Park Management running at http://localhost:${PORT}`);
  scheduleDailyLateFeeCheck();
});
