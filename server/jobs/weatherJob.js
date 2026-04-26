/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Weather Alert Monitor — checks NWS every 30 min.
 * Requires admin toggle ON + dedup check before sending.
 */
const { db } = require('../database');
const { sendSms } = require('../twilio');
const { fetchNWSAlerts } = require('../routes/weather-alerts');

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

function logMessage(tenant, channel, subject, bodyPreview, status) {
  var date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  var recipientName = tenant ? ((tenant.first_name || '') + ' ' + (tenant.last_name || '')) : 'Manager';
  var key = 'weather:' + (tenant ? tenant.id : 'manager') + ':' + date + ':' + subject.slice(0, 50) + ':' + channel;
  try {
    db.prepare(
      'INSERT OR IGNORE INTO auto_message_log (message_type, recipient_id, recipient_name, recipient_phone, channel, subject, body_preview, status, dedup_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('weather', tenant?.id || null, recipientName, tenant?.phone || '', channel, subject, (bodyPreview || '').slice(0, 200), status, key);
  } catch (e) {
    console.error('[weather-job] log insert failed:', e.message);
  }
}

async function checkAndAlert() {
  const results = { checked: 0, newAlerts: 0, messagesPosted: 0, skipped: 0 };

  try {
    const alerts = await fetchNWSAlerts();
    results.checked = alerts.length;

    for (const alert of alerts) {
      if (!SEVERE_TYPES.has(alert.event)) { results.skipped++; continue; }
      if (alreadySent(alert.id)) { results.skipped++; continue; }

      const tenants = db.prepare('SELECT id, first_name, last_name, lot_id, phone FROM tenants WHERE is_active = 1').all();

      const msgBody = `WEATHER ALERT: ${alert.event}\n${alert.headline || ''}\nStay safe! Call 409-267-6603 if emergency.`;
      const subject = `Weather Alert: ${alert.event}`;
      let messageCount = 0;

      for (const t of tenants) {
        try {
          db.prepare('INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 1)')
            .run(t.id, subject, msgBody, 'weather_alert');
          logMessage(t, 'in_app', subject, msgBody, 'sent');
          messageCount++;
        } catch (err) {
          console.error(`[weather-job] message insert failed for tenant ${t.id}:`, err.message);
          logMessage(t, 'in_app', subject, msgBody, 'failed');
        }
      }

      db.prepare('INSERT INTO weather_alerts_sent (nws_alert_id, alert_type, headline, sms_sent, tenant_count, message_count) VALUES (?, ?, ?, 0, 0, ?)')
        .run(alert.id, alert.event, alert.headline || '', messageCount);

      // SMS to manager ONLY
      const mgrPhone = getManagerPhone();
      if (mgrPhone) {
        var mgrMsg = `NEW WEATHER ALERT: ${alert.event} - ${alert.headline || ''}\nIn-app messages posted to ${messageCount} tenants.\nLog into app to review and send SMS to tenants if needed.`;
        try {
          await sendSms(mgrPhone, mgrMsg);
          logMessage(null, 'sms', subject, mgrMsg, 'sent');
        } catch (e) {
          console.error('[weather-job] manager SMS failed:', e.message);
          logMessage(null, 'sms', subject, mgrMsg, 'failed');
        }
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
  setTimeout(() => {
    if (isEnabled()) checkAndAlert().catch(e => console.error('[weather-job] error:', e.message));
    setInterval(() => {
      if (isEnabled()) checkAndAlert().catch(e => console.error('[weather-job] error:', e.message));
    }, 30 * 60 * 1000);
  }, 60 * 1000);
  console.log('[weather-job] weather alert monitor started (every 30 min)');
}

module.exports = { start, checkAndAlert };
