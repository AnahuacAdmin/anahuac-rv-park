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
  // Ensure every active tenant has at least one meter_readings row for their
  // current lot. If they don't (newly added tenant, or moved to a new lot),
  // create a zero-value placeholder dated today so the lot shows up in the
  // list and the operator can fill in real values.
  const today = new Date().toISOString().split('T')[0];
  const activeTenants = db.prepare(
    `SELECT id, lot_id FROM tenants WHERE is_active = 1 AND lot_id IS NOT NULL AND lot_id != ''`
  ).all();
  for (const t of activeTenants) {
    const existing = db.prepare(
      `SELECT id FROM meter_readings WHERE tenant_id = ? AND lot_id = ? LIMIT 1`
    ).get(t.id, t.lot_id);
    if (!existing) {
      db.prepare(`
        INSERT INTO meter_readings
          (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge)
        VALUES (?, ?, ?, 0, 0, 0, 0.15, 0)
      `).run(t.lot_id, t.id, today);
    }
  }

  const readings = db.prepare(`
    SELECT mr.*, t.first_name, t.last_name, t.monthly_rent, t.rent_type
    FROM meter_readings mr
    JOIN tenants t ON mr.tenant_id = t.id AND t.is_active = 1
    WHERE mr.id IN (
      SELECT MAX(id) FROM meter_readings WHERE tenant_id = mr.tenant_id GROUP BY lot_id
    )
    ORDER BY mr.lot_id
  `).all();
  res.json(readings);
});

router.post('/', (req, res) => {
  const { lot_id, tenant_id, reading_date, previous_reading, current_reading, photo } = req.body;
  const rate = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
  const ratePerKwh = parseFloat(rate?.value || 0.15);
  const kwh = current_reading - previous_reading;
  const charge = +(kwh * ratePerKwh).toFixed(2);

  const result = db.prepare(`
    INSERT INTO meter_readings (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge, photo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh, ratePerKwh, charge, photo || null);
  res.json({ id: result.lastInsertRowid, kwh_used: kwh, electric_charge: charge });
});

router.put('/:id', (req, res) => {
  const { previous_reading, current_reading, reading_date, photo } = req.body;
  const rate = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
  const ratePerKwh = parseFloat(rate?.value || 0.15);
  const kwh = current_reading - previous_reading;
  const charge = +(kwh * ratePerKwh).toFixed(2);

  if (photo !== undefined) {
    db.prepare(`
      UPDATE meter_readings SET previous_reading=?, current_reading=?, reading_date=?, kwh_used=?, rate_per_kwh=?, electric_charge=?, photo=?
      WHERE id = ?
    `).run(previous_reading, current_reading, reading_date, kwh, ratePerKwh, charge, photo || null, req.params.id);
  } else {
    db.prepare(`
      UPDATE meter_readings SET previous_reading=?, current_reading=?, reading_date=?, kwh_used=?, rate_per_kwh=?, electric_charge=?
      WHERE id = ?
    `).run(previous_reading, current_reading, reading_date, kwh, ratePerKwh, charge, req.params.id);
  }
  res.json({ success: true });
});

// Serve a meter reading photo as an image.
router.get('/:id/photo', (req, res) => {
  const row = db.prepare('SELECT photo FROM meter_readings WHERE id = ?').get(req.params.id);
  if (!row?.photo) return res.status(404).json({ error: 'No photo for this reading' });
  const buf = Buffer.from(row.photo, 'base64');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buf);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM meter_readings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
