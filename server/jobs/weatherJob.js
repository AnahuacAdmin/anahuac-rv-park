/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const { db } = require('../database');
const { sendSms } = require('../twilio');
const { fetchNWSAlerts } = require('../routes/weather-alerts');

// Alert types that trigger in-app messages
const SEVERE_TYPES = new Set([
  'Tornado Warning',
  'Tornado Watch',
  'Flash Flood Warning',
  'Flash Flood Watch',
  'Severe Thunderstorm Warning',
  'Hurricane Warning',
  'Hurricane Watch',
  'Tropical Storm Warning',
  'Winter Storm Warning',
  'Extreme Wind Warning',
]);

function isEnabled() {
  try {
    return db.prepare("SELECT value FROM settings WHERE key = 'weather_alerts_enabled'").get()?.value === '1';
  } catch { return false; }
}

function getManagerPhone() {
  return db.prepare("SELECT value FROM settings WHERE key = 'manager_phone'").get()?.value;
}

function alreadySent(nwsAlertId) {
  return !!db.prepare('SELECT id FROM weather_alerts_sent WHERE nws_alert_id = ?').get(nwsAlertId);
}

async function checkAndAlert() {
  const results = { checked: 0, newAlerts: 0, messagesPosted: 0, skipped: 0 };

  try {
    const alerts = await fetchNWSAlerts();
    results.checked = alerts.length;

    for (const alert of alerts) {
      if (!SEVERE_TYPES.has(alert.event)) { results.skipped++; continue; }
      if (alreadySent(alert.id)) { results.skipped++; continue; }

      // New severe alert — post in-app message to all active tenants (NO SMS)
      const tenants = db.prepare('SELECT id, first_name, last_name, lot_id FROM tenants WHERE is_active = 1').all();

      const msgBody = `⚠️ WEATHER ALERT: ${alert.event}\n${alert.headline || ''}\nStay safe! Call 409-267-6603 if emergency.`;
      let messageCount = 0;

      for (const t of tenants) {
        try {
          db.prepare('INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 1)')
            .run(t.id, `Weather Alert: ${alert.event}`, msgBody, 'weather_alert');
          messageCount++;
        } catch (err) {
          console.error(`[weather-job] message insert failed for tenant ${t.id}:`, err.message);
        }
      }

      // Record the alert as processed
      db.prepare('INSERT INTO weather_alerts_sent (nws_alert_id, alert_type, headline, sms_sent, tenant_count, message_count) VALUES (?, ?, ?, 0, 0, ?)')
        .run(alert.id, alert.event, alert.headline || '', messageCount);

      // SMS to manager ONLY — never auto-SMS tenants
      const mgrPhone = getManagerPhone();
      if (mgrPhone) {
        try {
          await sendSms(mgrPhone, `🌩️ NEW WEATHER ALERT: ${alert.event} - ${alert.headline || ''}\nIn-app messages posted to ${messageCount} tenants.\nLog into app to review and send SMS to tenants if needed.`);
        } catch (e) { console.error('[weather-job] manager SMS failed:', e.message); }
      }

      results.newAlerts++;
      results.messagesPosted += messageCount;
      console.log(`[weather-job] ALERT: ${alert.event} — in-app messages posted to ${messageCount} tenants`);
    }
  } catch (err) {
    console.error('[weather-job] check failed:', err.message);
  }

  return results;
}

function start() {
  // First check after 60 seconds (let server warm up)
  setTimeout(() => {
    if (isEnabled()) checkAndAlert().catch(e => console.error('[weather-job] error:', e.message));
    // Then every 30 minutes
    setInterval(() => {
      if (isEnabled()) checkAndAlert().catch(e => console.error('[weather-job] error:', e.message));
    }, 30 * 60 * 1000);
  }, 60 * 1000);
  console.log('[weather-job] weather alert monitor started (every 30 min)');
}

module.exports = { start, checkAndAlert };
