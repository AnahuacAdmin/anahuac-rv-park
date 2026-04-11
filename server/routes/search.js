const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ tenants: [], checkins: [], reservations: [], invoices: [] });

  const like = `%${q}%`;

  const tenants = db.prepare(`
    SELECT id, lot_id, first_name, last_name, phone, email
    FROM tenants WHERE is_active = 1 AND (
      first_name LIKE ? OR last_name LIKE ? OR lot_id LIKE ? OR phone LIKE ? OR email LIKE ?
      OR (first_name || ' ' || last_name) LIKE ?
    ) LIMIT 5
  `).all(like, like, like, like, like, like);

  const checkins = db.prepare(`
    SELECT c.id, c.lot_id, c.check_in_date, c.check_out_date, c.status, t.first_name, t.last_name
    FROM checkins c JOIN tenants t ON c.tenant_id = t.id
    WHERE t.first_name LIKE ? OR t.last_name LIKE ? OR c.lot_id LIKE ?
      OR (t.first_name || ' ' || t.last_name) LIKE ?
    ORDER BY c.created_at DESC LIMIT 5
  `).all(like, like, like, like);

  let reservations = [];
  try {
    reservations = db.prepare(`
      SELECT id, guest_name, lot_id, arrival_date, departure_date, status, confirmation_number
      FROM reservations WHERE
        guest_name LIKE ? OR lot_id LIKE ? OR confirmation_number LIKE ? OR status LIKE ?
      ORDER BY arrival_date DESC LIMIT 5
    `).all(like, like, like, like);
  } catch {}

  const invoices = db.prepare(`
    SELECT i.id, i.invoice_number, i.lot_id, i.invoice_date, i.total_amount, i.balance_due, i.status,
      t.first_name, t.last_name
    FROM invoices i JOIN tenants t ON i.tenant_id = t.id
    WHERE COALESCE(i.deleted, 0) = 0 AND (
      i.invoice_number LIKE ? OR i.lot_id LIKE ? OR t.first_name LIKE ? OR t.last_name LIKE ?
      OR (t.first_name || ' ' || t.last_name) LIKE ?
    ) ORDER BY i.invoice_date DESC LIMIT 5
  `).all(like, like, like, like, like);

  res.json({ tenants, checkins, reservations, invoices });
});

module.exports = router;
