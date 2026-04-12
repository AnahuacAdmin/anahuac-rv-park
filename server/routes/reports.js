const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

router.get('/monthly/:year/:month', (req, res) => {
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDate = `${ym}-01`;
  const endDate = `${ym}-${daysInMonth}`;

  // Summary
  const collected = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM payments WHERE payment_date BETWEEN ? AND ?").get(startDate, endDate).t;
  const invoiced = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as t FROM invoices WHERE invoice_date BETWEEN ? AND ? AND COALESCE(deleted,0)=0").get(startDate, endDate).t;
  const outstanding = db.prepare("SELECT COALESCE(SUM(balance_due), 0) as t FROM invoices WHERE status IN ('pending','partial') AND COALESCE(deleted,0)=0").get().t;
  const electricRev = db.prepare("SELECT COALESCE(SUM(electric_amount), 0) as t FROM invoices WHERE invoice_date BETWEEN ? AND ? AND COALESCE(deleted,0)=0").get(startDate, endDate).t;

  const totalLots = db.prepare('SELECT COUNT(*) as c FROM lots').get().c;
  const reserved = db.prepare("SELECT COUNT(*) as c FROM lots WHERE status = 'owner_reserved'").get().c;
  const occupied = db.prepare("SELECT COUNT(*) as c FROM lots WHERE status = 'occupied'").get().c;
  const occupancyRate = (totalLots - reserved) > 0 ? Math.round(occupied / (totalLots - reserved) * 100) : 0;

  // By rate type
  const byRateType = db.prepare(`
    SELECT t.rent_type, COUNT(*) as count, COALESCE(SUM(p.paid), 0) as total_paid
    FROM tenants t
    LEFT JOIN (SELECT tenant_id, SUM(amount) as paid FROM payments WHERE payment_date BETWEEN ? AND ? GROUP BY tenant_id) p ON p.tenant_id = t.id
    WHERE t.is_active = 1
    GROUP BY t.rent_type
  `).all(startDate, endDate);

  // Top 5 balances
  const topBalances = db.prepare(`
    SELECT t.lot_id, t.first_name, t.last_name, COALESCE(SUM(i.balance_due), 0) as balance
    FROM tenants t
    JOIN invoices i ON i.tenant_id = t.id AND i.status IN ('pending','partial') AND COALESCE(i.deleted,0)=0
    WHERE t.is_active = 1
    GROUP BY t.id ORDER BY balance DESC LIMIT 5
  `).all();

  // Payments list
  const payments = db.prepare(`
    SELECT p.payment_date, p.amount, p.payment_method, t.first_name, t.last_name, t.lot_id
    FROM payments p JOIN tenants t ON p.tenant_id = t.id
    WHERE p.payment_date BETWEEN ? AND ?
    ORDER BY p.payment_date DESC
  `).all(startDate, endDate);

  // Tenant detail
  const tenantDetail = db.prepare(`
    SELECT t.lot_id, t.first_name, t.last_name, t.rent_type, t.monthly_rent,
      COALESCE(paid.total, 0) as amount_paid,
      COALESCE(owed.balance, 0) as balance_due
    FROM tenants t
    LEFT JOIN (SELECT tenant_id, SUM(amount) as total FROM payments WHERE payment_date BETWEEN ? AND ? GROUP BY tenant_id) paid ON paid.tenant_id = t.id
    LEFT JOIN (SELECT tenant_id, SUM(balance_due) as balance FROM invoices WHERE status IN ('pending','partial') AND COALESCE(deleted,0)=0 GROUP BY tenant_id) owed ON owed.tenant_id = t.id
    WHERE t.is_active = 1
    ORDER BY t.lot_id
  `).all(startDate, endDate);

  res.json({ year, month, ym, collected, invoiced, outstanding, electricRev, occupancyRate, occupied, totalLots, reserved, byRateType, topBalances, payments, tenantDetail });
});

module.exports = router;
