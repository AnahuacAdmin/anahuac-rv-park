/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  try {
  const totalLots = db.prepare('SELECT COUNT(*) as count FROM lots').get().count;
  const occupied = db.prepare("SELECT COUNT(*) as count FROM lots WHERE status = 'occupied'").get().count;
  const vacant = db.prepare("SELECT COUNT(*) as count FROM lots WHERE status = 'vacant'").get().count;
  const reserved = db.prepare("SELECT COUNT(*) as count FROM lots WHERE status = 'owner_reserved'").get().count;
  const activeTenants = db.prepare('SELECT COUNT(*) as count FROM tenants WHERE is_active = 1').get().count;
  const waitlistCount = db.prepare("SELECT COUNT(*) as count FROM waitlist WHERE status = 'waiting'").get().count;

  let pendingReservations = 0;
  try {
    pendingReservations = db.prepare("SELECT COUNT(*) as count FROM reservations WHERE status IN ('pending','confirmed') AND arrival_date >= date('now')").get().count;
  } catch {}

  const monthlyRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM payments
    WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')
  `).get().total;

  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const pendingInvoices = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE status = 'pending' AND COALESCE(deleted,0)=0 AND strftime('%Y-%m', invoice_date) = ?").get(currentMonth).count;
  const partialInvoices = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE status = 'partial' AND COALESCE(deleted,0)=0 AND strftime('%Y-%m', invoice_date) = ?").get(currentMonth).count;
  const paidInvoices = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE status = 'paid' AND COALESCE(deleted,0)=0 AND strftime('%Y-%m', invoice_date) = ?").get(currentMonth).count;
  const totalOutstanding = db.prepare("SELECT COALESCE(SUM(balance_due), 0) as total FROM invoices WHERE status IN ('pending', 'partial') AND COALESCE(deleted,0)=0 AND strftime('%Y-%m', invoice_date) = ?").get(currentMonth).total;

  // Last month revenue for trend comparison
  const lastMonthRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM payments
    WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', date('now', '-1 month'))
  `).get().total;

  const recentPayments = db.prepare(`
    SELECT p.*, t.first_name, t.last_name, t.lot_id
    FROM payments p JOIN tenants t ON p.tenant_id = t.id
    ORDER BY p.created_at DESC, p.id DESC LIMIT 5
  `).all();

  const totalKwh = db.prepare(`
    SELECT COALESCE(SUM(kwh_used), 0) as total FROM meter_readings
    WHERE id IN (SELECT MAX(id) FROM meter_readings GROUP BY lot_id)
  `).get().total;

  // Revenue history: last 6 months
  const revenueHistory = [];
  for (let i = 5; i >= 0; i--) {
    const ym = db.prepare("SELECT strftime('%Y-%m', date('now', ?)) as ym").get(`-${i} months`).ym;
    const collected = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM payments WHERE strftime('%Y-%m', payment_date) = ?").get(ym).t;
    const billed = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as t FROM invoices WHERE strftime('%Y-%m', invoice_date) = ? AND COALESCE(deleted,0)=0").get(ym).t;
    const outstanding = db.prepare("SELECT COALESCE(SUM(balance_due), 0) as t FROM invoices WHERE strftime('%Y-%m', invoice_date) = ? AND COALESCE(deleted,0)=0 AND balance_due > 0.005").get(ym).t;
    const label = new Date(ym + '-15').toLocaleString('default', { month: 'short' });
    revenueHistory.push({ ym, label, collected, billed, outstanding });
  }

  // Recent activity feed
  const activity = [];
  const rp = db.prepare("SELECT p.amount, p.payment_date, p.created_at, t.first_name, t.last_name, t.lot_id FROM payments p JOIN tenants t ON p.tenant_id = t.id ORDER BY p.id DESC LIMIT 5").all();
  rp.forEach(p => activity.push({ type: 'payment', icon: '💰', text: `Payment $${Number(p.amount).toFixed(2)} from ${p.first_name} ${p.last_name} (${p.lot_id})`, date: p.payment_date, ts: p.created_at }));
  const rc = db.prepare("SELECT c.check_in_date, c.created_at, c.lot_id, t.first_name, t.last_name FROM checkins c JOIN tenants t ON c.tenant_id = t.id ORDER BY c.id DESC LIMIT 5").all();
  rc.forEach(c => activity.push({ type: 'checkin', icon: '🏕️', text: `${c.first_name} ${c.last_name} checked in to Lot ${c.lot_id}`, date: c.check_in_date, ts: c.created_at }));
  activity.sort((a, b) => (b.ts || b.date || '').localeCompare(a.ts || a.date || ''));

  // Revenue by guest type (grouped)
  const revenueByType = [];
  try {
    const typeRows = db.prepare(`
      SELECT t.rent_type, COALESCE(SUM(i.total_amount), 0) as revenue
      FROM invoices i
      JOIN tenants t ON i.tenant_id = t.id
      WHERE COALESCE(i.deleted, 0) = 0
      GROUP BY t.rent_type
    `).all();
    let longTerm = 0, shortTerm = 0, electricOnly = 0;
    for (const r of typeRows) {
      const rt = (r.rent_type || 'monthly').toLowerCase();
      if (rt === 'electric_only') electricOnly += r.revenue;
      else if (['daily', 'weekly', 'short_term'].includes(rt)) shortTerm += r.revenue;
      else longTerm += r.revenue; // monthly, standard, flat_rate, premium, prorated, etc.
    }
    if (longTerm > 0) revenueByType.push({ label: 'Long Term (Monthly)', revenue: longTerm });
    if (shortTerm > 0) revenueByType.push({ label: 'Short Term (Daily/Weekly)', revenue: shortTerm });
    if (electricOnly > 0) revenueByType.push({ label: 'Electric Only', revenue: electricOnly });
  } catch {}

  // Upcoming reservations
  let upcomingReservations = [];
  try {
    upcomingReservations = db.prepare("SELECT guest_name, lot_id, arrival_date, departure_date, nights, status, confirmation_number FROM reservations WHERE status IN ('pending','confirmed') AND arrival_date >= date('now') ORDER BY arrival_date LIMIT 5").all();
  } catch {}

  res.json({
    totalLots, occupied, vacant, reserved, activeTenants, waitlistCount, pendingReservations,
    monthlyRevenue, lastMonthRevenue, pendingInvoices, partialInvoices, paidInvoices, invoiceMonth: currentMonth,
    totalOutstanding, recentPayments, totalKwh, revenueHistory, revenueByType,
    activity: activity.slice(0, 10), upcomingReservations,
    occupancyRate: totalLots - reserved > 0 ? Math.round((occupied / (totalLots - reserved)) * 100) : 0,
  });
  } catch (err) {
    console.error('[dashboard] failed:', err);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

// Weekly arrivals & departures for the calendar widget
router.get('/weekly-schedule', (req, res) => {
  try {
    // Get Monday of current week
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day; // Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d.toISOString().split('T')[0]);
    }

    const weekStart = days[0];
    const weekEnd = days[6];

    // Reservations arriving or departing this week
    const arrivals = db.prepare(`
      SELECT guest_name as name, lot_id, phone, arrival_date as date, 'reservation' as source
      FROM reservations WHERE arrival_date >= ? AND arrival_date <= ? AND status IN ('pending','confirmed')
    `).all(weekStart, weekEnd);

    const departures = db.prepare(`
      SELECT guest_name as name, lot_id, phone, departure_date as date, 'reservation' as source
      FROM reservations WHERE departure_date >= ? AND departure_date <= ? AND status IN ('confirmed','checked-in')
    `).all(weekStart, weekEnd);

    // Tenants with move_in_date or move_out_date this week
    const tenantArrivals = db.prepare(`
      SELECT first_name || ' ' || last_name as name, lot_id, phone, move_in_date as date, 'tenant' as source
      FROM tenants WHERE move_in_date >= ? AND move_in_date <= ? AND is_active = 1
    `).all(weekStart, weekEnd);

    const tenantDepartures = db.prepare(`
      SELECT first_name || ' ' || last_name as name, lot_id, phone, move_out_date as date, 'tenant' as source
      FROM tenants WHERE move_out_date >= ? AND move_out_date <= ?
    `).all(weekStart, weekEnd);

    // Merge (avoid duplicates by lot)
    const allArrivals = [...arrivals];
    tenantArrivals.forEach(t => {
      if (!allArrivals.some(a => a.lot_id === t.lot_id && a.date === t.date)) allArrivals.push(t);
    });
    const allDepartures = [...departures];
    tenantDepartures.forEach(t => {
      if (!allDepartures.some(d => d.lot_id === t.lot_id && d.date === t.date)) allDepartures.push(t);
    });

    res.json({ days, arrivals: allArrivals, departures: allDepartures });
  } catch (err) {
    console.error('[dashboard] weekly-schedule failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Vacancy cost tracker
router.get('/vacancy-cost', (req, res) => {
  try {
    var vacantLots = db.prepare("SELECT id, default_rate FROM lots WHERE status='vacant'").all();
    var totalCost = 0;
    var details = vacantLots.map(function(lot) {
      // Find last checkout date for this lot
      var lastCheckout = db.prepare("SELECT check_out_date FROM checkins WHERE lot_id=? AND check_out_date IS NOT NULL ORDER BY check_out_date DESC LIMIT 1").get(lot.id);
      var daysVacant = 0;
      if (lastCheckout && lastCheckout.check_out_date) {
        daysVacant = Math.max(0, Math.floor((Date.now() - new Date(lastCheckout.check_out_date + 'T00:00:00').getTime()) / 86400000));
      }
      var dailyRate = (lot.default_rate || 295) / 30;
      var cost = Math.round(daysVacant * dailyRate);
      totalCost += cost;
      return { lot_id: lot.id, daysVacant: daysVacant, lostRevenue: cost };
    }).filter(function(v) { return v.daysVacant > 0; }).sort(function(a, b) { return b.lostRevenue - a.lostRevenue; });
    res.json({ totalCost: totalCost, vacantLots: details });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upcoming birthdays for dashboard widget (next 7 days)
router.get('/upcoming-birthdays', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    var { getUpcomingBirthdays } = require('../jobs/birthdayJob');
    res.json(getUpcomingBirthdays(7));
  } catch (e) {
    res.json([]);
  }
});

module.exports = router;
