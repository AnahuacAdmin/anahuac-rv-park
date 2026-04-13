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

  const pendingInvoices = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE status = 'pending' AND COALESCE(deleted,0)=0").get().count;
  const partialInvoices = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE status = 'partial' AND COALESCE(deleted,0)=0").get().count;
  const paidInvoices = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE status = 'paid' AND COALESCE(deleted,0)=0").get().count;
  const totalOutstanding = db.prepare("SELECT COALESCE(SUM(balance_due), 0) as total FROM invoices WHERE status IN ('pending', 'partial') AND COALESCE(deleted,0)=0").get().total;

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

  // Upcoming reservations
  let upcomingReservations = [];
  try {
    upcomingReservations = db.prepare("SELECT guest_name, lot_id, arrival_date, departure_date, nights, status, confirmation_number FROM reservations WHERE status IN ('pending','confirmed') AND arrival_date >= date('now') ORDER BY arrival_date LIMIT 5").all();
  } catch {}

  res.json({
    totalLots, occupied, vacant, reserved, activeTenants, waitlistCount, pendingReservations,
    monthlyRevenue, lastMonthRevenue, pendingInvoices, partialInvoices, paidInvoices,
    totalOutstanding, recentPayments, totalKwh, revenueHistory,
    activity: activity.slice(0, 10), upcomingReservations,
    occupancyRate: totalLots - reserved > 0 ? Math.round((occupied / (totalLots - reserved)) * 100) : 0,
  });
  } catch (err) {
    console.error('[dashboard] failed:', err);
    res.status(500).json({ error: 'Failed to load dashboard data' });
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

module.exports = router;
