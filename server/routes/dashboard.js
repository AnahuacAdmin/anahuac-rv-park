const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const totalLots = db.prepare('SELECT COUNT(*) as count FROM lots').get().count;
  console.log('[dashboard] total_lots returned from DB =', totalLots);
  const occupied = db.prepare("SELECT COUNT(*) as count FROM lots WHERE status = 'occupied'").get().count;
  const vacant = db.prepare("SELECT COUNT(*) as count FROM lots WHERE status = 'vacant'").get().count;
  const reserved = db.prepare("SELECT COUNT(*) as count FROM lots WHERE status = 'owner_reserved'").get().count;
  const activeTenants = db.prepare('SELECT COUNT(*) as count FROM tenants WHERE is_active = 1').get().count;
  const waitlistCount = db.prepare("SELECT COUNT(*) as count FROM waitlist WHERE status = 'waiting'").get().count;

  const monthlyRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM payments
    WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')
  `).get().total;

  const pendingInvoices = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE status = 'pending'").get().count;
  const totalOutstanding = db.prepare("SELECT COALESCE(SUM(balance_due), 0) as total FROM invoices WHERE status IN ('pending', 'partial')").get().total;

  const recentPayments = db.prepare(`
    SELECT p.*, t.first_name, t.last_name, t.lot_id
    FROM payments p JOIN tenants t ON p.tenant_id = t.id
    ORDER BY p.payment_date DESC LIMIT 5
  `).all();

  const totalKwh = db.prepare(`
    SELECT COALESCE(SUM(kwh_used), 0) as total FROM meter_readings
    WHERE id IN (SELECT MAX(id) FROM meter_readings GROUP BY lot_id)
  `).get().total;

  res.json({
    totalLots, occupied, vacant, reserved, activeTenants, waitlistCount,
    monthlyRevenue, pendingInvoices, totalOutstanding, recentPayments, totalKwh,
    occupancyRate: Math.round((occupied / (totalLots - reserved)) * 100)
  });
});

module.exports = router;
