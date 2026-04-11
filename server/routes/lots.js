const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const lots = db.prepare(`
    SELECT l.*, t.id as tenant_id, t.first_name, t.last_name, t.monthly_rent, t.rent_type, t.eviction_warning
    FROM lots l
    LEFT JOIN tenants t ON l.id = t.lot_id AND t.is_active = 1
    ORDER BY l.row_letter, l.lot_number
  `).all();

  const today = new Date().toISOString().split('T')[0];
  for (const lot of lots) {
    lot.payment_flag = null;
    lot.balance_due = 0;
    if (!lot.tenant_id) continue;
    const inv = db.prepare(`
      SELECT COALESCE(SUM(balance_due),0) as balance,
             COALESCE(SUM(amount_paid),0) as paid,
             MIN(due_date) as earliest_due
      FROM invoices WHERE tenant_id = ? AND balance_due > 0.005
    `).get(lot.tenant_id);
    lot.balance_due = inv.balance || 0;
    if (lot.balance_due > 0.005) {
      if ((inv.paid || 0) > 0) {
        lot.payment_flag = 'partial';
      } else if (inv.earliest_due && inv.earliest_due < today) {
        lot.payment_flag = 'overdue';
      } else {
        lot.payment_flag = 'unpaid';
      }
    }
  }
  res.json(lots);
});

router.get('/:id', (req, res) => {
  const lot = db.prepare(`
    SELECT l.*, t.id as tenant_id, t.first_name, t.last_name, t.monthly_rent, t.phone, t.email, t.rent_type
    FROM lots l
    LEFT JOIN tenants t ON l.id = t.lot_id AND t.is_active = 1
    WHERE l.id = ?
  `).get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });
  res.json(lot);
});

router.get('/:id/detail', (req, res) => {
  const lot = db.prepare(`
    SELECT l.*, t.*, l.id as lot_id, t.id as tenant_id
    FROM lots l
    LEFT JOIN tenants t ON l.id = t.lot_id AND t.is_active = 1
    WHERE l.id = ?
  `).get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });

  const result = { lot, tenant: null, currentInvoice: null, invoices: [], payments: [], meters: [], messages: [] };
  if (lot.tenant_id) {
    result.tenant = lot;
    result.invoices = db.prepare(
      'SELECT * FROM invoices WHERE tenant_id = ? ORDER BY invoice_date DESC LIMIT 6'
    ).all(lot.tenant_id);
    result.currentInvoice = result.invoices.find(i => i.balance_due > 0.005) || result.invoices[0] || null;
    result.payments = db.prepare(
      'SELECT * FROM payments WHERE tenant_id = ? ORDER BY payment_date DESC LIMIT 12'
    ).all(lot.tenant_id);
    result.meters = db.prepare(
      'SELECT * FROM meter_readings WHERE tenant_id = ? ORDER BY reading_date DESC LIMIT 3'
    ).all(lot.tenant_id);
    result.messages = db.prepare(
      'SELECT * FROM messages WHERE tenant_id = ? ORDER BY sent_date DESC LIMIT 20'
    ).all(lot.tenant_id);
  }
  res.json(result);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM lots WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lot not found' });
  const status = req.body.status ?? existing.status;
  const notes = req.body.notes ?? existing.notes;
  const size_restriction = req.body.size_restriction ?? existing.size_restriction;
  db.prepare('UPDATE lots SET status = ?, notes = ?, size_restriction = ? WHERE id = ?')
    .run(status, notes, size_restriction, req.params.id);
  res.json({ success: true });
});

module.exports = router;
