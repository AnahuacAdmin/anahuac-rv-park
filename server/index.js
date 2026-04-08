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

app.use(express.json({ limit: '1mb' }));
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

// Initialize database
initializeDatabase();

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/lots', require('./routes/lots'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/meters', require('./routes/meters'));
app.use('/api/invoices', require('./routes/invoices'));
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

app.listen(PORT, () => {
  console.log(`Anahuac RV Park Management running at http://localhost:${PORT}`);
});
