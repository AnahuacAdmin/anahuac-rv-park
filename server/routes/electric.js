const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

// Electric analytics data — usage history, stats, per-lot details
router.get('/analytics', (req, res) => {
  const months = parseInt(req.query.months) || 6;

  // Monthly usage per lot for the last N months
  const history = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = db.prepare("SELECT strftime('%Y-%m', date('now', ?)) as ym").get(`-${i} months`).ym;
    const label = new Date(ym + '-15').toLocaleString('default', { month: 'short', year: '2-digit' });
    const readings = db.prepare(`
      SELECT mr.lot_id, SUM(mr.kwh_used) as kwh, SUM(mr.electric_charge) as charge, t.first_name, t.last_name
      FROM meter_readings mr
      LEFT JOIN tenants t ON mr.tenant_id = t.id
      WHERE strftime('%Y-%m', mr.reading_date) = ?
      GROUP BY mr.lot_id
    `).all(ym);
    history.push({ ym, label, readings });
  }

  // Collect all lot IDs that have readings
  const allLots = [...new Set(history.flatMap(h => h.readings.map(r => r.lot_id)))].sort();

  // Current month stats
  const currentYm = db.prepare("SELECT strftime('%Y-%m', 'now') as ym").get().ym;
  const currentMonth = db.prepare(`
    SELECT COALESCE(SUM(kwh_used), 0) as totalKwh, COALESCE(SUM(electric_charge), 0) as totalCharge, COUNT(DISTINCT lot_id) as lotCount
    FROM meter_readings WHERE strftime('%Y-%m', reading_date) = ?
  `).get(currentYm);

  const lastYm = db.prepare("SELECT strftime('%Y-%m', date('now', '-1 month')) as ym").get().ym;
  const lastMonth = db.prepare(`
    SELECT COALESCE(SUM(kwh_used), 0) as totalKwh
    FROM meter_readings WHERE strftime('%Y-%m', reading_date) = ?
  `).get(lastYm);

  // Highest and lowest usage lots (current month)
  const lotStats = db.prepare(`
    SELECT mr.lot_id, SUM(mr.kwh_used) as kwh, SUM(mr.electric_charge) as charge, t.first_name, t.last_name
    FROM meter_readings mr
    LEFT JOIN tenants t ON mr.tenant_id = t.id AND t.is_active = 1
    WHERE strftime('%Y-%m', mr.reading_date) = ?
    GROUP BY mr.lot_id ORDER BY kwh DESC
  `).all(currentYm);

  const highest = lotStats[0] || null;
  const lowest = lotStats.length ? lotStats[lotStats.length - 1] : null;
  const avgKwh = lotStats.length ? Math.round(lotStats.reduce((s, l) => s + l.kwh, 0) / lotStats.length) : 0;
  const avgCharge = lotStats.length ? +(lotStats.reduce((s, l) => s + l.charge, 0) / lotStats.length).toFixed(2) : 0;

  res.json({ history, allLots, currentMonth, lastMonth, highest, lowest, avgKwh, avgCharge });
});

// Per-lot detail
router.get('/lot/:lotId', (req, res) => {
  const readings = db.prepare(`
    SELECT mr.*, t.first_name, t.last_name
    FROM meter_readings mr
    LEFT JOIN tenants t ON mr.tenant_id = t.id
    WHERE mr.lot_id = ?
    ORDER BY mr.reading_date DESC
  `).all(req.params.lotId);

  // Monthly aggregates
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', reading_date) as ym, SUM(kwh_used) as kwh, SUM(electric_charge) as charge
    FROM meter_readings WHERE lot_id = ?
    GROUP BY ym ORDER BY ym DESC LIMIT 12
  `).all(req.params.lotId);

  const avgKwh = monthly.length ? Math.round(monthly.reduce((s, m) => s + m.kwh, 0) / monthly.length) : 0;
  const avgCharge = monthly.length ? +(monthly.reduce((s, m) => s + m.charge, 0) / monthly.length).toFixed(2) : 0;
  const highestMonth = monthly.reduce((h, m) => m.kwh > (h?.kwh || 0) ? m : h, null);
  const lowestMonth = monthly.filter(m => m.kwh > 0).reduce((l, m) => m.kwh < (l?.kwh || Infinity) ? m : l, null);

  res.json({ readings, monthly: monthly.reverse(), avgKwh, avgCharge, highestMonth, lowestMonth });
});

module.exports = router;
