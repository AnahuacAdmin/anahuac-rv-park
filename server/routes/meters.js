const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.get('/', (req, res) => {
  const readings = db.prepare(`
    SELECT mr.*, t.first_name, t.last_name, l.id as lot_name
    FROM meter_readings mr
    JOIN tenants t ON mr.tenant_id = t.id
    JOIN lots l ON mr.lot_id = l.id
    ORDER BY mr.reading_date DESC, mr.lot_id
  `).all();
  res.json(readings);
});

router.get('/lot/:lotId', (req, res) => {
  const readings = db.prepare(`
    SELECT mr.*, t.first_name, t.last_name
    FROM meter_readings mr
    JOIN tenants t ON mr.tenant_id = t.id
    WHERE mr.lot_id = ?
    ORDER BY mr.reading_date DESC
  `).all(req.params.lotId);
  res.json(readings);
});

router.get('/latest', (req, res) => {
  const readings = db.prepare(`
    SELECT mr.*, t.first_name, t.last_name, t.monthly_rent, t.rent_type
    FROM meter_readings mr
    JOIN tenants t ON mr.tenant_id = t.id AND t.is_active = 1
    WHERE mr.id IN (
      SELECT MAX(id) FROM meter_readings GROUP BY lot_id
    )
    ORDER BY mr.lot_id
  `).all();
  res.json(readings);
});

router.post('/', (req, res) => {
  const { lot_id, tenant_id, reading_date, previous_reading, current_reading } = req.body;
  const rate = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
  const ratePerKwh = parseFloat(rate?.value || 0.15);
  const kwh = current_reading - previous_reading;
  const charge = kwh * ratePerKwh;

  const result = db.prepare(`
    INSERT INTO meter_readings (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh, ratePerKwh, charge);
  res.json({ id: result.lastInsertRowid, kwh_used: kwh, electric_charge: charge });
});

router.put('/:id', (req, res) => {
  const { previous_reading, current_reading, reading_date } = req.body;
  const rate = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
  const ratePerKwh = parseFloat(rate?.value || 0.15);
  const kwh = current_reading - previous_reading;
  const charge = kwh * ratePerKwh;

  db.prepare(`
    UPDATE meter_readings SET previous_reading=?, current_reading=?, reading_date=?, kwh_used=?, rate_per_kwh=?, electric_charge=?
    WHERE id = ?
  `).run(previous_reading, current_reading, reading_date, kwh, ratePerKwh, charge, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM meter_readings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
