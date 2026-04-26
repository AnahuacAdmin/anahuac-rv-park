/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Daily Arrival/Departure Reminder — sends SMS to manager at 8 AM CST.
 * Requires admin toggle ON + dedup check before sending.
 */
const { db } = require('../database');
const { sendSms } = require('../twilio');

function isEnabled() {
  try {
    return db.prepare("SELECT value FROM settings WHERE key = 'daily_reminder_enabled'").get()?.value === '1';
  } catch { return false; } // default OFF
}

function getManagerPhone() {
  return db.prepare("SELECT value FROM settings WHERE key = 'manager_phone'").get()?.value;
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function alreadySent(date) {
  var key = 'reminder:manager:' + date + ':sms';
  return !!db.prepare('SELECT id FROM auto_message_log WHERE dedup_key = ?').get(key);
}

function logMessage(channel, subject, bodyPreview, status) {
  var date = todayStr();
  var key = 'reminder:manager:' + date + ':' + channel;
  try {
    db.prepare(
      'INSERT OR IGNORE INTO auto_message_log (message_type, recipient_id, recipient_name, recipient_phone, channel, subject, body_preview, status, dedup_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('reminder', null, 'Manager', getManagerPhone() || '', channel, subject, (bodyPreview || '').slice(0, 200), status, key);
  } catch (e) {
    console.error('[reminder-job] log insert failed:', e.message);
  }
}

function getTodayArrivals() {
  const today = todayStr();
  const arrivals = [];

  try {
    const res = db.prepare(`
      SELECT guest_name as name, lot_id, phone FROM reservations
      WHERE arrival_date = ? AND status IN ('pending','confirmed')
    `).all(today);
    arrivals.push(...res);
  } catch {}

  try {
    const tenants = db.prepare(`
      SELECT first_name || ' ' || last_name as name, lot_id, phone FROM tenants
      WHERE move_in_date = ? AND is_active = 1
    `).all(today);
    tenants.forEach(t => {
      if (!arrivals.some(a => a.lot_id === t.lot_id)) arrivals.push(t);
    });
  } catch {}

  return arrivals;
}

function getTodayDepartures() {
  const today = todayStr();
  const departures = [];

  try {
    const res = db.prepare(`
      SELECT guest_name as name, lot_id, phone FROM reservations
      WHERE departure_date = ? AND status IN ('confirmed','checked-in')
    `).all(today);
    departures.push(...res);
  } catch {}

  try {
    const tenants = db.prepare(`
      SELECT first_name || ' ' || last_name as name, lot_id, phone FROM tenants
      WHERE move_out_date = ? AND is_active = 1
    `).all(today);
    tenants.forEach(t => {
      if (!departures.some(d => d.lot_id === t.lot_id)) departures.push(t);
    });
  } catch {}

  return departures;
}

async function sendDailyReminder() {
  if (!isEnabled()) {
    console.log('[reminder-job] skipped — daily_reminder_enabled is OFF');
    return;
  }

  const today = todayStr();

  // Dedup check
  if (alreadySent(today)) {
    console.log('[reminder-job] skipped — already sent today (' + today + ')');
    return;
  }

  const arrivals = getTodayArrivals();
  const departures = getTodayDepartures();

  if (!arrivals.length && !departures.length) return;

  const mgrPhone = getManagerPhone();
  if (!mgrPhone) return;

  let msg = 'Good morning! Today at Anahuac RV Park:\n';

  if (arrivals.length) {
    msg += '\nARRIVING TODAY:\n';
    arrivals.forEach(a => {
      msg += `* ${a.name} > Lot ${a.lot_id || '?'}${a.phone ? ' (' + a.phone + ')' : ''}\n`;
    });
  }

  if (departures.length) {
    msg += '\nDEPARTING TODAY:\n';
    departures.forEach(d => {
      msg += `* ${d.name} > Lot ${d.lot_id || '?'}${d.phone ? ' (' + d.phone + ')' : ''}\n`;
    });
  }

  msg += '\nHave a great day!';

  try {
    await sendSms(mgrPhone, msg);
    logMessage('sms', 'Daily Arrival/Departure Reminder', msg, 'sent');
    console.log(`[reminder-job] daily reminder sent: ${arrivals.length} arrivals, ${departures.length} departures`);
  } catch (e) {
    logMessage('sms', 'Daily Arrival/Departure Reminder', msg, 'failed');
    console.error('[reminder-job] SMS failed:', e.message);
  }
}

function start() {
  function msUntilNext8AM() {
    const now = new Date();
    const chicagoStr = now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false });
    const [datePart, timePart] = chicagoStr.split(', ');
    const [h, m, s] = timePart.split(':').map(Number);
    const currentMins = h * 60 + m;
    const targetMins = 8 * 60;

    let diffMins = targetMins - currentMins;
    if (diffMins <= 0) diffMins += 24 * 60;

    return diffMins * 60 * 1000 - s * 1000;
  }

  function schedule() {
    const ms = msUntilNext8AM();
    setTimeout(() => {
      sendDailyReminder().catch(e => console.error('[reminder-job] error:', e.message));
      setTimeout(schedule, 1000);
    }, ms);
    console.log(`[reminder-job] next daily reminder in ${Math.round(ms / 60000)} minutes`);
  }

  schedule();
  console.log('[reminder-job] daily arrival/departure reminder started (8:00 AM CST)');
}

module.exports = { start, sendDailyReminder, getTodayArrivals, getTodayDepartures };
