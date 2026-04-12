/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');
const { Resend } = require('resend');

let _resend = null;
function getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) throw new Error('Resend not configured');
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

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

// 12-month trend data for charts
router.get('/trends', (req, res) => {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yr = d.getFullYear(), mo = d.getMonth() + 1;
    const ym = `${yr}-${String(mo).padStart(2, '0')}`;
    const dim = new Date(yr, mo, 0).getDate();
    const start = `${ym}-01`, end = `${ym}-${dim}`;
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });

    const collected = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE payment_date BETWEEN ? AND ?").get(start, end).t;
    const invoiced = db.prepare("SELECT COALESCE(SUM(total_amount),0) as t FROM invoices WHERE invoice_date BETWEEN ? AND ? AND COALESCE(deleted,0)=0").get(start, end).t;
    const outstanding = db.prepare("SELECT COALESCE(SUM(balance_due),0) as t FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0").get(start, end).t;
    const electricKwh = db.prepare("SELECT COALESCE(SUM(kwh_used),0) as t FROM meter_readings WHERE reading_date BETWEEN ? AND ?").get(start, end).t;
    const electricRev = db.prepare("SELECT COALESCE(SUM(electric_amount),0) as t FROM invoices WHERE invoice_date BETWEEN ? AND ? AND COALESCE(deleted,0)=0").get(start, end).t;

    // Occupancy snapshot: count checkins active during this month
    const occupied = db.prepare("SELECT COUNT(DISTINCT tenant_id) as c FROM checkins WHERE check_in_date <= ? AND (check_out_date IS NULL OR check_out_date >= ?) AND status='checked_in'").get(end, start).c;
    const totalLots = db.prepare('SELECT COUNT(*) as c FROM lots').get().c;
    const reserved = db.prepare("SELECT COUNT(*) as c FROM lots WHERE status='owner_reserved'").get().c;
    const available = Math.max(1, totalLots - reserved);
    const occPct = Math.round((occupied / available) * 100);

    months.push({ ym, label, collected, invoiced, outstanding, electricKwh, electricRev, occupancy: Math.min(occPct, 100) });
  }

  // Revenue by rate type (current tenants)
  const byType = db.prepare(`
    SELECT rent_type, COUNT(*) as count, SUM(monthly_rent) as total_rent,
      SUM(CASE WHEN flat_rate=1 THEN flat_rate_amount ELSE 0 END) as flat_total
    FROM tenants WHERE is_active=1 GROUP BY rent_type
  `).all();

  // Invoice status distribution (all non-deleted)
  const statusDist = db.prepare(`
    SELECT status, COUNT(*) as count FROM invoices WHERE COALESCE(deleted,0)=0 GROUP BY status
  `).all();

  // Top 10 outstanding
  const topOutstanding = db.prepare(`
    SELECT t.lot_id, t.first_name, t.last_name, COALESCE(SUM(i.balance_due),0) as balance
    FROM tenants t JOIN invoices i ON i.tenant_id=t.id AND i.status IN ('pending','partial') AND COALESCE(i.deleted,0)=0
    WHERE t.is_active=1 GROUP BY t.id ORDER BY balance DESC LIMIT 10
  `).all();

  res.json({ months, byType, statusDist, topOutstanding });
});

// Email a report as PDF attachment
router.post('/email', async (req, res) => {
  const { to, subject, message, monthName, pdfBase64, summary } = req.body;
  if (!to || !pdfBase64) return res.status(400).json({ error: 'Email and PDF are required' });

  try {
    const resend = getResend();
    const htmlBody = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1a5c32;color:#fff;padding:1rem 1.5rem;border-radius:10px 10px 0 0">
          <h2 style="margin:0">Anahuac RV Park</h2>
          <p style="margin:4px 0 0;opacity:0.8">Financial Report — ${monthName || 'Monthly'}</p>
        </div>
        <div style="padding:1.5rem;background:#fff;border:1px solid #e7e5e4;border-top:none;border-radius:0 0 10px 10px">
          ${summary ? `<div style="display:flex;gap:0.5rem;margin-bottom:1rem;text-align:center">
            <div style="flex:1;background:#f0fdf4;padding:0.75rem;border-radius:8px"><div style="font-size:1.1rem;font-weight:800;color:#1a5c32">$${Number(summary.collected).toFixed(2)}</div><div style="font-size:0.7rem;color:#78716c">Collected</div></div>
            <div style="flex:1;background:#fee2e2;padding:0.75rem;border-radius:8px"><div style="font-size:1.1rem;font-weight:800;color:#dc2626">$${Number(summary.outstanding).toFixed(2)}</div><div style="font-size:0.7rem;color:#78716c">Outstanding</div></div>
            <div style="flex:1;background:#eff6ff;padding:0.75rem;border-radius:8px"><div style="font-size:1.1rem;font-weight:800;color:#0284c7">${summary.occupancyRate}%</div><div style="font-size:0.7rem;color:#78716c">Occupancy</div></div>
          </div>` : ''}
          <p>Please find the full financial report attached as a PDF.</p>
          ${message ? `<p style="background:#fafaf9;padding:0.75rem;border-radius:8px;border-left:3px solid #f59e0b;font-style:italic">${message}</p>` : ''}
          <p style="font-size:0.8rem;color:#78716c;margin-top:1.5rem">Anahuac RV Park, LLC · 1003 Davis Ave, Anahuac TX 77514 · 409-267-6603</p>
        </div>
      </div>`;

    await resend.emails.send({
      from: 'Anahuac RV Park <invoices@anrvpark.com>',
      reply_to: 'anrvpark@gmail.com',
      to,
      subject: subject || `Anahuac RV Park — Financial Report`,
      html: htmlBody,
      attachments: [{
        filename: `AnahuacRVPark_Report_${(monthName || 'Report').replace(/\s/g, '')}.pdf`,
        content: Buffer.from(pdfBase64, 'base64'),
      }],
    });

    res.json({ success: true, sentTo: to });
  } catch (err) {
    console.error('[reports] email failed:', err);
    res.status(500).json({ error: err.message || 'Failed to send report' });
  }
});

module.exports = router;
