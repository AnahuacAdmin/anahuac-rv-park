const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, t.first_name, t.last_name, t.lot_id, i.invoice_number
    FROM payments p
    JOIN tenants t ON p.tenant_id = t.id
    LEFT JOIN invoices i ON p.invoice_id = i.id
    ORDER BY p.payment_date DESC
  `).all();
  res.json(payments);
});

router.get('/tenant/:tenantId', (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, i.invoice_number
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.tenant_id = ?
    ORDER BY p.payment_date DESC
  `).all(req.params.tenantId);
  res.json(payments);
});

router.post('/', (req, res) => {
  const { tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes } = req.body;

  const result = db.prepare(`
    INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes);

  // Update invoice if linked
  if (invoice_id) {
    const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?').get(invoice_id);
    const invoice = db.prepare('SELECT total_amount FROM invoices WHERE id = ?').get(invoice_id);
    const balance = (invoice?.total_amount || 0) - totalPaid.total;
    const status = balance <= 0 ? 'paid' : 'partial';
    db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
      .run(totalPaid.total, Math.max(0, balance), status, invoice_id);
  }

  res.json({ id: result.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  const payment = db.prepare('SELECT invoice_id, amount FROM payments WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);

  if (payment?.invoice_id) {
    const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?').get(payment.invoice_id);
    const invoice = db.prepare('SELECT total_amount FROM invoices WHERE id = ?').get(payment.invoice_id);
    const balance = (invoice?.total_amount || 0) - totalPaid.total;
    db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
      .run(totalPaid.total, Math.max(0, balance), balance <= 0 ? 'paid' : 'pending', payment.invoice_id);
  }

  res.json({ success: true });
});

module.exports = router;
