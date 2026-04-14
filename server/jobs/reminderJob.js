/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const { db } = require('../database');
const { sendSms } = require('../twilio');

function isEnabled() {
  try {
    return db.prepare("SELECT value FROM settings WHERE key = 'daily_reminder_enabled'").get()?.value !== '0';
  } catch { return true; } // default ON
}

function getManagerPhone() {
  return db.prepare("SELECT value FROM settings WHERE key = 'manager_phone'").get()?.value;
}

function todayStr() {
  // Use Chicago timezone for date
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function getTodayArrivals() {
  const today = todayStr();
  const arrivals = [];

  // Reservations arriving today
  try {
    const res = db.prepare(`
      SELECT guest_name as name, lot_id, phone FROM reservations
      WHERE arrival_date = ? AND status IN ('pending','confirmed')
    `).all(today);
    arrivals.push(...res);
  } catch {}

  // Tenants with move_in_date today
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

  // Reservations departing today
  try {
    const res = db.prepare(`
      SELECT guest_name as name, lot_id, phone FROM reservations
      WHERE departure_date = ? AND status IN ('confirmed','checked-in')
    `).all(today);
    departures.push(...res);
  } catch {}

  // Tenants with move_out_date today
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
  if (!isEnabled()) return;

  const arrivals = getTodayArrivals();
  const departures = getTodayDepartures();

  if (!arrivals.length && !departures.length) return; // Nothing today, skip

  const mgrPhone = getManagerPhone();
  if (!mgrPhone) return;

  let msg = '📅 Good morning! Today at Anahuac RV Park:\n';

  if (arrivals.length) {
    msg += '\nARRIVING TODAY:\n';
    arrivals.forEach(a => {
      msg += `• ${a.name} → Lot ${a.lot_id || '?'}${a.phone ? ' (' + a.phone + ')' : ''}\n`;
    });
  }

  if (departures.length) {
    msg += '\nDEPARTING TODAY:\n';
    departures.forEach(d => {
      msg += `• ${d.name} → Lot ${d.lot_id || '?'}${d.phone ? ' (' + d.phone + ')' : ''}\n`;
    });
  }

  msg += '\nHave a great day! 🐊';

  try {
    await sendSms(mgrPhone, msg);
    console.log(`[reminder-job] daily reminder sent: ${arrivals.length} arrivals, ${departures.length} departures`);
  } catch (e) {
    console.error('[reminder-job] SMS failed:', e.message);
  }
}

function start() {
  // Schedule at 8:00 AM Chicago time
  function msUntilNext8AM() {
    const now = new Date();
    // Get current Chicago time
    const chicagoStr = now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false });
    const [datePart, timePart] = chicagoStr.split(', ');
    const [h, m, s] = timePart.split(':').map(Number);
    const currentMins = h * 60 + m;
    const targetMins = 8 * 60; // 8:00 AM

    let diffMins = targetMins - currentMins;
    if (diffMins <= 0) diffMins += 24 * 60; // Next day

    return diffMins * 60 * 1000 - s * 1000;
  }

  function schedule() {
    const ms = msUntilNext8AM();
    setTimeout(() => {
      sendDailyReminder().catch(e => console.error('[reminder-job] error:', e.message));
      // Reschedule for next day (use 24h + recalc to handle DST)
      setTimeout(schedule, 1000);
    }, ms);
    console.log(`[reminder-job] next daily reminder in ${Math.round(ms / 60000)} minutes`);
  }

  schedule();
  console.log('[reminder-job] daily arrival/departure reminder started (8:00 AM CST)');
}

module.exports = { start, sendDailyReminder, getTodayArrivals, getTodayDepartures };
