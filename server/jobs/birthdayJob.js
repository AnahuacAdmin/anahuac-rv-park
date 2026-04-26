/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Daily Birthday Check — runs at midnight, sends birthday greetings
 * Requires admin toggle ON + dedup check before sending.
 */
const { db } = require('../database');
const { sendSms } = require('../twilio');

function todayMMDD() {
  var d = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  return d.slice(5); // "04-18"
}

function todayDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function getParkName() {
  try {
    return db.prepare("SELECT value FROM settings WHERE key = 'park_name'").get()?.value || 'the Park';
  } catch { return 'the Park'; }
}

function isEnabled() {
  try {
    return db.prepare("SELECT value FROM settings WHERE key = 'auto_birthday_enabled'").get()?.value === '1';
  } catch { return false; } // default OFF
}

function alreadySent(tenantId, date, channel) {
  var key = 'birthday:' + tenantId + ':' + date + ':' + channel;
  return !!db.prepare('SELECT id FROM auto_message_log WHERE dedup_key = ?').get(key);
}

function logMessage(type, tenant, channel, subject, bodyPreview, status) {
  var date = todayDate();
  var key = type + ':' + tenant.id + ':' + date + ':' + channel;
  try {
    db.prepare(
      'INSERT OR IGNORE INTO auto_message_log (message_type, recipient_id, recipient_name, recipient_phone, channel, subject, body_preview, status, dedup_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(type, tenant.id, (tenant.first_name || '') + ' ' + (tenant.last_name || ''), tenant.phone || '', channel, subject, (bodyPreview || '').slice(0, 200), status, key);
  } catch (e) {
    console.error('[birthday-job] log insert failed:', e.message);
  }
}

function checkBirthdays() {
  // Guard: admin must enable birthday messages
  if (!isEnabled()) {
    console.log('[birthday-job] skipped — auto_birthday_enabled is OFF');
    return;
  }

  var mmdd = todayMMDD();
  var date = todayDate();
  var parkName = getParkName();
  console.log('[birthday-job] checking birthdays for ' + mmdd);

  var tenants;
  try {
    tenants = db.prepare(`
      SELECT id, first_name, last_name, phone, lot_id, date_of_birth, sms_opt_in
      FROM tenants
      WHERE is_active = 1
        AND date_of_birth IS NOT NULL
        AND date_of_birth != ''
        AND substr(date_of_birth, 6) = ?
    `).all(mmdd);
  } catch (e) {
    console.error('[birthday-job] query failed:', e.message);
    return;
  }

  if (!tenants.length) {
    console.log('[birthday-job] no birthdays today');
    return;
  }

  console.log('[birthday-job] ' + tenants.length + ' birthday(s) today!');

  tenants.forEach(function(t) {
    var name = t.first_name || 'Tenant';
    var subject = 'Happy Birthday, ' + name + '!';
    var msg = 'Happy Birthday ' + name + '! Wishing you a wonderful day from all of us here at ' +
      parkName + '. We hope your special day is filled with joy!\n\nSincerely,\nPark Management';

    // 1. Post to portal inbox (in-app message) — with dedup
    if (alreadySent(t.id, date, 'in_app')) {
      console.log('[birthday-job] SKIPPED duplicate in-app for ' + name + ' (tenant ' + t.id + ')');
      logMessage('birthday', t, 'in_app', subject, msg, 'blocked_duplicate');
    } else {
      try {
        db.prepare(
          "INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, 'birthday', 0)"
        ).run(t.id, subject, msg);
        logMessage('birthday', t, 'in_app', subject, msg, 'sent');
        console.log('[birthday-job] in-app message sent to ' + name);
      } catch (e) {
        console.error('[birthday-job] message insert failed for tenant ' + t.id + ':', e.message);
        logMessage('birthday', t, 'in_app', subject, msg, 'failed');
      }
    }

    // 2. Send SMS if configured and tenant opted in — with dedup
    if (t.phone && t.sms_opt_in !== 0) {
      var smsBody = 'Happy Birthday, ' + name + '! From all of us at ' + parkName + ' — have a wonderful day!';
      if (alreadySent(t.id, date, 'sms')) {
        console.log('[birthday-job] SKIPPED duplicate SMS for ' + name + ' (tenant ' + t.id + ')');
        logMessage('birthday', t, 'sms', subject, smsBody, 'blocked_duplicate');
      } else {
        try {
          sendSms(t.phone, smsBody);
          logMessage('birthday', t, 'sms', subject, smsBody, 'sent');
          console.log('[birthday-job] SMS sent to ' + name + ' (' + t.phone + ')');
        } catch (e) {
          console.error('[birthday-job] SMS failed for ' + name + ':', e.message);
          logMessage('birthday', t, 'sms', subject, smsBody, 'failed');
        }
      }
    }
  });
}

function start() {
  function msUntilMidnight() {
    var now = new Date();
    var chicagoStr = now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false });
    var timePart = chicagoStr.split(', ')[1] || '0:0:0';
    var parts = timePart.split(':').map(Number);
    var h = parts[0], m = parts[1], s = parts[2] || 0;
    var currentMins = h * 60 + m;
    var targetMins = 0; // midnight
    var diffMins = targetMins - currentMins;
    if (diffMins <= 0) diffMins += 24 * 60;
    return diffMins * 60 * 1000 - s * 1000;
  }

  function schedule() {
    var ms = msUntilMidnight();
    setTimeout(function() {
      try { checkBirthdays(); } catch (e) { console.error('[birthday-job] error:', e.message); }
      setTimeout(schedule, 1000); // recalc for next midnight
    }, ms);
    console.log('[birthday-job] next check in ' + Math.round(ms / 60000) + ' minutes');
  }

  schedule();
  console.log('[birthday-job] daily birthday check started (midnight CST)');
}

// Utility: get upcoming birthdays in next N days (for dashboard widget)
function getUpcomingBirthdays(days) {
  days = days || 7;
  try {
    var tenants = db.prepare(`
      SELECT id, first_name, last_name, lot_id, date_of_birth
      FROM tenants
      WHERE is_active = 1
        AND date_of_birth IS NOT NULL
        AND date_of_birth != ''
    `).all();

    var now = new Date();
    var chicagoDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    var thisYear = chicagoDate.getFullYear();
    var todayMs = new Date(thisYear, chicagoDate.getMonth(), chicagoDate.getDate()).getTime();

    var results = [];
    tenants.forEach(function(t) {
      var parts = String(t.date_of_birth).split('-');
      if (parts.length < 3) return;
      var bMonth = parseInt(parts[1]) - 1;
      var bDay = parseInt(parts[2]);
      var bYear = parseInt(parts[0]);
      if (isNaN(bMonth) || isNaN(bDay) || isNaN(bYear)) return;

      var bd = new Date(thisYear, bMonth, bDay);
      var diffDays = Math.round((bd.getTime() - todayMs) / 86400000);
      if (diffDays < 0) {
        bd = new Date(thisYear + 1, bMonth, bDay);
        diffDays = Math.round((bd.getTime() - todayMs) / 86400000);
      }
      if (diffDays >= 0 && diffDays <= days) {
        var age = thisYear - bYear + (diffDays === 0 ? 0 : (bMonth < chicagoDate.getMonth() || (bMonth === chicagoDate.getMonth() && bDay <= chicagoDate.getDate()) ? 1 : 0));
        results.push({
          id: t.id,
          first_name: t.first_name,
          last_name: t.last_name,
          lot_id: t.lot_id,
          date_of_birth: t.date_of_birth,
          birthday_date: (bMonth + 1) + '/' + bDay,
          days_until: diffDays,
          age: age,
        });
      }
    });

    results.sort(function(a, b) { return a.days_until - b.days_until; });
    return results;
  } catch (e) {
    console.error('[birthday-job] getUpcomingBirthdays error:', e.message);
    return [];
  }
}

module.exports = { start, checkBirthdays, getUpcomingBirthdays };
