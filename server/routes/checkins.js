const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const checkins = db.prepare(`
    SELECT c.*, t.first_name, t.last_name, l.id as lot_name
    FROM checkins c
    JOIN tenants t ON c.tenant_id = t.id
    JOIN lots l ON c.lot_id = l.id
    ORDER BY c.created_at DESC
  `).all();
  res.json(checkins);
});

router.post('/checkin', (req, res) => {
  const { tenant_id, lot_id, check_in_date, notes } = req.body;
  const result = db.prepare(`
    INSERT INTO checkins (tenant_id, lot_id, check_in_date, status, notes)
    VALUES (?, ?, ?, 'checked_in', ?)
  `).run(tenant_id, lot_id, check_in_date, notes);
  db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('occupied', lot_id);
  res.json({ id: result.lastInsertRowid });
});

router.post('/checkout', (req, res) => {
  const { tenant_id, lot_id, check_out_date, notes } = req.body;

  db.prepare(`
    UPDATE checkins SET check_out_date = ?, status = 'checked_out', notes = ?
    WHERE tenant_id = ? AND lot_id = ? AND status = 'checked_in'
  `).run(check_out_date, notes, tenant_id, lot_id);

  db.prepare('UPDATE tenants SET is_active = 0, move_out_date = ? WHERE id = ?')
    .run(check_out_date, tenant_id);
  db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('vacant', lot_id);

  res.json({ success: true });
});

module.exports = router;
