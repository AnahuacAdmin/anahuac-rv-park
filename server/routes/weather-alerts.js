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

const NWS_ZONE = 'TXZ204'; // Chambers County TX
const NWS_URL = `https://api.weather.gov/alerts/active?zone=${NWS_ZONE}`;

// Fetch active NWS alerts for Chambers County
async function fetchNWSAlerts() {
  const res = await fetch(NWS_URL, {
    headers: { 'User-Agent': 'AnahuacRVPark/1.0 (anrvpark@gmail.com)', Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`NWS API returned ${res.status}`);
  const data = await res.json();
  return (data.features || []).map(f => ({
    id: f.properties.id,
    event: f.properties.event,
    headline: f.properties.headline,
    description: (f.properties.description || '').slice(0, 500),
    severity: f.properties.severity,
    urgency: f.properties.urgency,
    onset: f.properties.onset,
    expires: f.properties.expires,
    senderName: f.properties.senderName,
  }));
}

// Public: current alerts (used by portal and dashboard)
router.get('/', async (req, res) => {
  try {
    const alerts = await fetchNWSAlerts();
    res.json(alerts);
  } catch (err) {
    console.error('[weather-alerts] fetch failed:', err.message);
    res.json([]);
  }
});

// Admin-only routes below
router.use(authenticate);
router.use(requireAdmin);

// History of sent alerts
router.get('/history', (req, res) => {
  const history = db.prepare('SELECT * FROM weather_alerts_sent ORDER BY sent_at DESC LIMIT 50').all();
  res.json(history);
});

// Manual check trigger (posts in-app messages only, no SMS to tenants)
router.post('/check', async (req, res) => {
  try {
    const { checkAndAlert } = require('../jobs/weatherJob');
    const result = await checkAndAlert();
    res.json(result);
  } catch (err) {
    console.error('[weather-alerts] manual check failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Test alert (sends to manager phone ONLY, never to tenants)
router.post('/test', async (req, res) => {
  const mgrPhone = db.prepare("SELECT value FROM settings WHERE key = 'manager_phone'").get()?.value;
  if (!mgrPhone) return res.status(400).json({ error: 'No manager phone configured in Settings.' });

  const msg = `✅ TEST WEATHER ALERT — Anahuac RV Park\nThis is a test of the weather alert system.\nTime: ${new Date().toLocaleString()}\nZone: ${NWS_ZONE} (Chambers County TX)\nAll clear — no active severe alerts.`;
  try {
    await sendSms(mgrPhone, msg);
    res.json({ success: true, message: 'Test alert sent to manager' });
  } catch (err) {
    res.status(500).json({ error: 'SMS failed: ' + err.message });
  }
});

// Admin manually sends SMS to ALL tenants for a specific alert
// This is the ONLY way SMS gets sent to tenants — never automatic
router.post('/send', async (req, res) => {
  const { alert_event, alert_headline, nws_alert_id } = req.body || {};
  if (!alert_event) return res.status(400).json({ error: 'Alert event type required' });

  const tenants = db.prepare('SELECT id, first_name, last_name, lot_id, phone FROM tenants WHERE is_active = 1 AND phone IS NOT NULL AND phone != ""').all();
  if (!tenants.length) return res.status(400).json({ error: 'No active tenants with phone numbers' });

  const smsBody = `⚠️ WEATHER ALERT - Anahuac RV Park\n${alert_event}: ${alert_headline || ''}\nStay safe! Call 409-267-6603 if emergency.`;

  let sent = 0, failed = 0;
  for (const t of tenants) {
    try {
      await sendSms(t.phone, smsBody);
      sent++;
    } catch (err) {
      failed++;
      console.error(`[weather-alerts] SMS to ${t.lot_id} failed:`, err.message);
    }
  }

  // Update the record if it exists, or create one
  if (nws_alert_id) {
    const existing = db.prepare('SELECT id FROM weather_alerts_sent WHERE nws_alert_id = ?').get(nws_alert_id);
    if (existing) {
      db.prepare('UPDATE weather_alerts_sent SET sms_sent = 1, tenant_count = ? WHERE nws_alert_id = ?').run(sent, nws_alert_id);
    } else {
      db.prepare('INSERT INTO weather_alerts_sent (nws_alert_id, alert_type, headline, sms_sent, tenant_count, message_count) VALUES (?, ?, ?, 1, ?, 0)')
        .run(nws_alert_id, alert_event, alert_headline || '', sent);
    }
  }

  // Notify manager of the send
  const mgrPhone = db.prepare("SELECT value FROM settings WHERE key = 'manager_phone'").get()?.value;
  if (mgrPhone) {
    try {
      await sendSms(mgrPhone, `🌩️ Weather alert SMS sent to ${sent} tenants (${failed} failed): ${alert_event}`);
    } catch {}
  }

  res.json({ success: true, sent, failed, total: tenants.length });
});

module.exports = router;
module.exports.fetchNWSAlerts = fetchNWSAlerts;
