/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');
const { sendSms } = require('../twilio');

// --- Service health checks ---
async function checkService(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    return { name, status: result.status || 'ok', message: result.message || 'Connected', responseTime: Date.now() - start, checkedAt: new Date().toISOString(), ...result.extra };
  } catch (err) {
    return { name, status: 'error', message: err.message || 'Unknown error', responseTime: Date.now() - start, checkedAt: new Date().toISOString() };
  }
}

async function runAllChecks() {
  return Promise.all([
    checkService('Database', async () => {
      const start = Date.now();
      const r = db.prepare('SELECT 1 as ok').get();
      if (!r?.ok) throw new Error('Query failed');
      const elapsed = Date.now() - start;
      const count = db.prepare('SELECT COUNT(*) as c FROM tenants').get().c;
      if (elapsed > 1000) return { status: 'warning', message: `Slow response (${elapsed}ms) — ${count} tenants` };
      return { message: `Connected (${count} tenants)` };
    }),
    checkService('Stripe', async () => {
      if (!process.env.STRIPE_SECRET_KEY) return { status: 'error', message: 'STRIPE_SECRET_KEY not set' };
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2022-11-15' });
      const account = await stripe.accounts.retrieve();
      const isTest = process.env.STRIPE_SECRET_KEY.startsWith('sk_test');
      if (isTest) return { status: 'warning', message: 'TEST mode active', extra: { mode: 'test' } };
      return { message: `Live — ${account.business_profile?.name || account.id}`, extra: { mode: 'live' } };
    }),
    checkService('Twilio', async () => {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return { status: 'error', message: 'Twilio credentials not set' };
      const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const account = await client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      let balance = null;
      try {
        const bal = await client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).balance.fetch();
        balance = parseFloat(bal.balance);
      } catch {}
      if (balance !== null && balance < 5) return { status: 'warning', message: `Low balance: $${balance.toFixed(2)}`, extra: { balance } };
      return { message: `Active${balance !== null ? ` — $${balance.toFixed(2)}` : ''}`, extra: { balance } };
    }),
    checkService('Internet', async () => {
      const r = await fetch('https://www.google.com', { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { message: 'Outbound OK' };
    }),
    checkService('Railway App', async () => {
      const uptime = process.uptime();
      const mem = process.memoryUsage();
      const mbUsed = Math.round(mem.heapUsed / 1024 / 1024);
      const pctUsed = Math.round((mem.heapUsed / mem.heapTotal) * 100);
      if (pctUsed > 80) return { status: 'warning', message: `High memory: ${mbUsed}MB (${pctUsed}%)`, extra: { uptime: Math.round(uptime), memoryMB: mbUsed } };
      return { message: `Uptime: ${Math.round(uptime / 60)}min — ${mbUsed}MB (${pctUsed}%)`, extra: { uptime: Math.round(uptime), memoryMB: mbUsed } };
    }),
  ]);
}

// --- API routes (require auth + admin) ---
router.use(authenticate);
router.use(requireAdmin);

router.get('/status', async (req, res) => {
  const checks = await runAllChecks();
  // Include last alert info
  const lastAlert = db.prepare('SELECT * FROM health_alerts ORDER BY alerted_at DESC LIMIT 1').get();
  const recentAlerts = db.prepare('SELECT * FROM health_alerts ORDER BY alerted_at DESC LIMIT 5').all();
  res.json({ services: checks, checkedAt: new Date().toISOString(), lastAlert, recentAlerts });
});

// Alert history
router.get('/alerts', (req, res) => {
  const alerts = db.prepare('SELECT * FROM health_alerts ORDER BY alerted_at DESC LIMIT 20').all();
  res.json(alerts);
});

// Test alert
router.post('/test-alert', async (req, res) => {
  const phones = getAlertPhones();
  if (!phones.length) return res.status(400).json({ error: 'No alert phone numbers configured. Add them in Settings.' });
  const msg = `✅ TEST ALERT — Anahuac RV Park\nThis is a test of the downtime alert system.\nTime: ${new Date().toLocaleString()}\nAll systems operational.`;
  let sent = 0;
  for (const phone of phones) {
    try { await sendSms(phone, msg); sent++; } catch (e) { console.error(`[health] test alert to ${phone} failed:`, e.message); }
  }
  res.json({ success: true, sent, total: phones.length });
});

// --- Background monitor ---
// Track previous state per service to detect transitions
const _prevState = {};
const _lastAlertTime = {}; // service -> timestamp, for rate limiting (1 per hour)
const ALERT_COOLDOWN = 60 * 60 * 1000; // 1 hour

function getAlertPhones() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'alert_phone_numbers'").get();
    if (!row?.value) return [];
    return row.value.split(',').map(p => p.trim()).filter(Boolean);
  } catch { return []; }
}

function isAlertsEnabled() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'downtime_alerts_enabled'").get();
    return row?.value === '1';
  } catch { return false; }
}

async function sendAlert(service, status, message) {
  const phones = getAlertPhones();
  if (!phones.length) return;

  const now = Date.now();
  const contactInfo = {
    'Database': 'Check Railway volume storage — railway.app/dashboard',
    'Stripe': 'Stripe support — dashboard.stripe.com',
    'Twilio': 'Twilio support — console.twilio.com',
    'Internet': 'Check Railway network — railway.app/dashboard',
    'Railway App': 'Check Railway dashboard — railway.app/dashboard',
  };

  const isDown = status === 'error';
  const body = isDown
    ? `🚨 ANAHUAC RV PARK ALERT\nService: ${service} is DOWN\nTime: ${new Date().toLocaleString()}\nIssue: ${message}\nAction: ${contactInfo[service] || 'Contact support'}`
    : `✅ ANAHUAC RV PARK — ALL CLEAR\nService: ${service} is back UP\nTime: ${new Date().toLocaleString()}\nStatus: ${message}`;

  for (const phone of phones) {
    try { await sendSms(phone, body); } catch (e) { console.error(`[health-alert] SMS to ${phone} failed:`, e.message); }
  }

  // Record in database
  if (isDown) {
    db.prepare('INSERT INTO health_alerts (service, status, message) VALUES (?, ?, ?)').run(service, status, message);
  } else {
    // Resolve the most recent open alert for this service
    db.prepare("UPDATE health_alerts SET resolved_at = datetime('now') WHERE service = ? AND resolved_at IS NULL").run(service);
  }

  _lastAlertTime[service] = now;
  console.log(`[health-alert] ${isDown ? 'DOWN' : 'RECOVERED'}: ${service} — ${message}`);
}

async function backgroundHealthCheck() {
  if (!isAlertsEnabled()) return;

  try {
    const checks = await runAllChecks();
    for (const svc of checks) {
      const prev = _prevState[svc.name];
      const now = svc.status;

      // Detect transitions
      if (prev && prev !== 'error' && now === 'error') {
        // OK/warning → error: service went down
        const lastSent = _lastAlertTime[svc.name] || 0;
        if (Date.now() - lastSent > ALERT_COOLDOWN) {
          await sendAlert(svc.name, 'error', svc.message);
        }
      } else if (prev === 'error' && now !== 'error') {
        // error → ok/warning: service recovered
        await sendAlert(svc.name, 'ok', svc.message);
      }

      _prevState[svc.name] = now;
    }
  } catch (err) {
    console.error('[health-monitor] background check failed:', err.message);
  }
}

// Start the background monitor (every 5 minutes)
function startHealthMonitor() {
  // Run first check after 30 seconds (let services warm up)
  setTimeout(() => {
    backgroundHealthCheck();
    setInterval(backgroundHealthCheck, 5 * 60 * 1000);
  }, 30 * 1000);
  console.log('[health-monitor] background health check started (every 5 min)');
}

module.exports = router;
module.exports.startHealthMonitor = startHealthMonitor;
