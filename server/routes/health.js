/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Smart Heartbeat with Downtime Alerting
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');
const { sendSms } = require('../twilio');

// --- Human-readable uptime ---
function humanUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

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

// Core checks (fast — used by heartbeat)
function runCoreChecks() {
  const checks = {};

  // Database
  try {
    const start = Date.now();
    const r = db.prepare('SELECT 1 as ok').get();
    if (!r?.ok) throw new Error('Query returned no result');
    const elapsed = Date.now() - start;
    checks.database = elapsed > 1000 ? `warning: slow (${elapsed}ms)` : 'ok';
  } catch (err) {
    checks.database = 'error: ' + err.message;
  }

  // Portal query (the one that broke production)
  try {
    db.prepare(`SELECT id, invoice_number, invoice_date, total_amount, balance_due, status,
      rent_amount, electric_amount, mailbox_fee, misc_fee, extra_occupancy_fee, late_fee,
      refund_amount, refund_description, credit_applied
      FROM invoices LIMIT 0`).get();
    checks.portal = 'ok';
  } catch (err) {
    checks.portal = 'error: ' + err.message;
  }

  // Stripe keys
  checks.stripe = process.env.STRIPE_SECRET_KEY ? 'ok' : 'error: keys missing';

  // Memory / disk proxy
  const mem = process.memoryUsage();
  const pctUsed = Math.round((mem.heapUsed / mem.heapTotal) * 100);
  checks.memory = pctUsed > 90 ? `warning: ${pctUsed}% heap used` : 'ok';

  return checks;
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

// ==========================================
// PUBLIC HEARTBEAT — no auth required
// ==========================================
router.get('/heartbeat', (req, res) => {
  try {
    const checks = runCoreChecks();
    const hasError = Object.values(checks).some(v => v.startsWith('error'));
    const descriptions = [];

    if (checks.database.startsWith('error')) descriptions.push('Database connection failed — SQLite file may be corrupted or disk full');
    if (checks.portal.startsWith('error')) descriptions.push('Portal query crashed — column mismatch in invoices table');
    if (checks.stripe.startsWith('error')) descriptions.push('Stripe payment keys not configured — online payments will fail');
    if (checks.memory.startsWith('warning')) descriptions.push('Server memory running low — may need restart');

    res.json({
      status: hasError ? 'unhealthy' : 'healthy',
      uptime: humanUptime(process.uptime()),
      timestamp: new Date().toISOString(),
      checks,
      downSince: _downSince ? _downSince.toISOString() : null,
      description: descriptions.length ? descriptions.join('. ') + '.' : null,
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      uptime: humanUptime(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database: 'error: ' + err.message, portal: 'unknown', stripe: 'unknown', memory: 'unknown' },
      downSince: _downSince ? _downSince.toISOString() : new Date().toISOString(),
      description: 'Health check itself crashed — server may be in a bad state: ' + err.message,
    });
  }
});

// ==========================================
// ADMIN ROUTES — require auth
// ==========================================
router.use(authenticate);
router.use(requireAdmin);

router.get('/status', async (req, res) => {
  try {
    const checks = await runAllChecks();
    const lastAlert = db.prepare('SELECT * FROM health_alerts ORDER BY alerted_at DESC LIMIT 1').get();
    const recentAlerts = db.prepare('SELECT * FROM health_alerts ORDER BY alerted_at DESC LIMIT 5').all();
    res.json({ services: checks, checkedAt: new Date().toISOString(), lastAlert, recentAlerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/alerts', (req, res) => {
  const alerts = db.prepare('SELECT * FROM health_alerts ORDER BY alerted_at DESC LIMIT 20').all();
  res.json(alerts);
});

// Downtime history
router.get('/downtime', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM downtime_log ORDER BY start_time DESC LIMIT 50').all();

    // Uptime percentage this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const totalMinutesInMonth = (now - new Date(now.getFullYear(), now.getMonth(), 1)) / 60000;
    const downtimeRows = db.prepare("SELECT start_time, end_time FROM downtime_log WHERE start_time >= ?").all(monthStart);
    let downtimeMinutes = 0;
    for (const row of downtimeRows) {
      const start = new Date(row.start_time);
      const end = row.end_time ? new Date(row.end_time) : now;
      downtimeMinutes += (end - start) / 60000;
    }
    const uptimePct = totalMinutesInMonth > 0 ? Math.max(0, 100 - (downtimeMinutes / totalMinutesInMonth * 100)) : 100;

    res.json({
      logs,
      uptimePercent: Math.round(uptimePct * 100) / 100,
      downtimeMinutesThisMonth: Math.round(downtimeMinutes),
      currentStatus: _downSince ? 'down' : 'up',
      downSince: _downSince ? _downSince.toISOString() : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test alert
router.post('/test-alert', async (req, res) => {
  try {
    const phones = getAlertPhones();
    if (!phones.length) return res.status(400).json({ error: 'No alert phone numbers configured. Add them in Settings.' });
    const msg = `✅ TEST ALERT — Anahuac RV Park\nThis is a test of the downtime alert system.\nTime: ${new Date().toLocaleString()}\nAll systems operational.`;
    let sent = 0;
    for (const phone of phones) {
      try { await sendSms(phone, msg); sent++; } catch (e) { console.error(`[health] test alert to ${phone} failed:`, e.message); }
    }

    // Also test email
    let emailSent = false;
    try {
      const email = getAlertEmail();
      if (email) {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Anahuac RV Park <noreply@anrvpark.com>',
          to: email,
          subject: '✅ Test Alert — Anahuac RV Park',
          text: msg,
        });
        emailSent = true;
      }
    } catch (e) { console.error('[health] test email failed:', e.message); }

    res.json({ success: true, smsSent: sent, smsTotal: phones.length, emailSent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// BACKGROUND MONITOR — smart heartbeat
// ==========================================
let _downSince = null;        // Date when system first went unhealthy
let _downReason = '';          // Human-readable reason
let _alertsSent = 0;          // Count of alerts sent for current incident
let _lastAlertTime = 0;       // Timestamp of last alert sent
let _pendingConfirm = false;  // True if we detected failure but haven't confirmed yet
let _pendingTime = 0;         // When we first detected the pending failure
const _prevState = {};         // Per-service state tracking

const CHECK_INTERVAL = 5 * 60 * 1000;   // 5 minutes
const CONFIRM_DELAY = 2 * 60 * 1000;    // 2 minutes to confirm not a blip
const REPEAT_INTERVAL = 10 * 60 * 1000; // 10 minutes between repeat alerts

function getAlertPhones() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'alert_phone_numbers'").get();
    if (!row?.value) return [];
    return row.value.split(',').map(p => p.trim()).filter(Boolean);
  } catch { return []; }
}

function getAlertEmail() {
  try {
    return db.prepare("SELECT value FROM settings WHERE key = 'manager_email'").get()?.value || 'anrvpark@gmail.com';
  } catch { return 'anrvpark@gmail.com'; }
}

function isAlertsEnabled() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'downtime_alerts_enabled'").get();
    return row?.value === '1';
  } catch { return false; }
}

async function sendDowntimeAlert(reason, isRecovery) {
  const phones = getAlertPhones();
  const email = getAlertEmail();
  if (!phones.length && !email) return;

  let body;
  if (isRecovery) {
    const downMinutes = _downSince ? Math.round((Date.now() - _downSince.getTime()) / 60000) : 0;
    body = `✅ Anahuac RV Park app is back online.\nWas down for ${downMinutes} minute${downMinutes !== 1 ? 's' : ''}.\nCause: ${_downReason}\nRecovered: ${new Date().toLocaleString()}`;
  } else {
    body = `⚠️ ANAHUAC RV PARK APP IS DOWN\n${reason}\nDown since: ${_downSince ? _downSince.toLocaleString() : new Date().toLocaleString()}\nWe are monitoring and attempting to recover.\nCheck: https://web-production-89794.up.railway.app/api/health/heartbeat`;
  }

  // SMS
  for (const phone of phones) {
    try { await sendSms(phone, body); } catch (e) { console.error(`[heartbeat] SMS to ${phone} failed:`, e.message); }
  }

  // Email
  if (email && process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Anahuac RV Park <noreply@anrvpark.com>',
        to: email,
        subject: isRecovery ? '✅ App Back Online — Anahuac RV Park' : '⚠️ APP DOWN — Anahuac RV Park',
        text: body,
      });
    } catch (e) { console.error('[heartbeat] email failed:', e.message); }
  }

  _alertsSent++;
  _lastAlertTime = Date.now();
  console.log(`[heartbeat] ${isRecovery ? 'RECOVERY' : 'DOWN'} alert #${_alertsSent}: ${reason}`);
}

async function smartHeartbeatCheck() {
  if (!isAlertsEnabled()) return;

  try {
    const checks = runCoreChecks();
    const errors = Object.entries(checks).filter(([, v]) => v.startsWith('error'));
    const isHealthy = errors.length === 0;

    // Also run per-service monitoring for the full checks (Twilio, Stripe API, etc.)
    try {
      const fullChecks = await runAllChecks();
      for (const svc of fullChecks) {
        const prev = _prevState[svc.name];
        const now = svc.status;
        if (prev === 'error' && now !== 'error') {
          // Service recovered — log to health_alerts
          db.prepare("UPDATE health_alerts SET resolved_at = datetime('now') WHERE service = ? AND resolved_at IS NULL").run(svc.name);
          console.log(`[heartbeat] Service recovered: ${svc.name}`);
        } else if (prev && prev !== 'error' && now === 'error') {
          db.prepare('INSERT INTO health_alerts (service, status, message) VALUES (?, ?, ?)').run(svc.name, 'error', svc.message);
          console.log(`[heartbeat] Service down: ${svc.name} — ${svc.message}`);
        }
        _prevState[svc.name] = now;
      }
    } catch (e) { /* full checks failing shouldn't prevent core monitoring */ }

    if (isHealthy) {
      // System is healthy
      if (_pendingConfirm) {
        // Was pending — turned out to be a blip
        console.log('[heartbeat] Blip resolved — not alerting');
        _pendingConfirm = false;
      }
      if (_downSince) {
        // Was down, now recovered!
        await sendDowntimeAlert(_downReason, true);

        // Log recovery to downtime_log
        try {
          const downMinutes = Math.round((Date.now() - _downSince.getTime()) / 60000);
          db.prepare("UPDATE downtime_log SET end_time = datetime('now'), duration_minutes = ?, alerts_sent = ? WHERE end_time IS NULL")
            .run(downMinutes, _alertsSent);
        } catch (e) { console.error('[heartbeat] log recovery error:', e.message); }

        _downSince = null;
        _downReason = '';
        _alertsSent = 0;
        _pendingConfirm = false;
      }
      return;
    }

    // System is unhealthy
    const reason = errors.map(([k, v]) => `${k}: ${v}`).join('; ');

    if (!_downSince && !_pendingConfirm) {
      // First failure detected — start confirmation window
      _pendingConfirm = true;
      _pendingTime = Date.now();
      _downReason = reason;
      console.log(`[heartbeat] Potential issue detected, confirming in 2 min: ${reason}`);

      // Schedule confirmation check in 2 minutes
      setTimeout(async () => {
        if (!_pendingConfirm) return; // Already resolved

        // Re-check
        const recheck = runCoreChecks();
        const recheckErrors = Object.entries(recheck).filter(([, v]) => v.startsWith('error'));
        if (recheckErrors.length === 0) {
          console.log('[heartbeat] Confirmation check passed — was a blip');
          _pendingConfirm = false;
          return;
        }

        // Confirmed down
        _downSince = new Date(_pendingTime);
        _downReason = recheckErrors.map(([k, v]) => `${k}: ${v}`).join('; ');
        _pendingConfirm = false;
        _alertsSent = 0;

        // Log to downtime_log
        try {
          db.prepare("INSERT INTO downtime_log (start_time, reason) VALUES (?, ?)").run(_downSince.toISOString(), _downReason);
        } catch (e) { console.error('[heartbeat] log downtime error:', e.message); }

        // Send first alert
        await sendDowntimeAlert(_downReason, false);
      }, CONFIRM_DELAY);

      return;
    }

    if (_downSince) {
      // Already confirmed down — send repeat alerts every 10 minutes
      _downReason = reason; // Update with latest reason
      if (Date.now() - _lastAlertTime >= REPEAT_INTERVAL) {
        await sendDowntimeAlert(reason, false);
      }
    }

  } catch (err) {
    console.error('[heartbeat] monitor failed:', err.message);
  }
}

// Start the background monitor
function startHealthMonitor() {
  setTimeout(() => {
    smartHeartbeatCheck();
    setInterval(smartHeartbeatCheck, CHECK_INTERVAL);
  }, 30 * 1000);
  console.log('[heartbeat] smart health monitor started (every 5 min, 2 min confirm, 10 min repeat alerts)');
}

module.exports = router;
module.exports.startHealthMonitor = startHealthMonitor;
