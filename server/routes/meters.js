const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { db, DB_PATH } = require('../database');
const { authenticate } = require('../middleware');

// Photos directory: next to the database on the Railway volume.
const PHOTOS_DIR = path.join(path.dirname(DB_PATH), 'uploads', 'meter-photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

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

// Save a base64 photo to disk, return the filename.
function savePhoto(readingId, base64Data) {
  if (!base64Data) return null;
  const filename = `meter-${readingId}.jpg`;
  const filepath = path.join(PHOTOS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
  return filename;
}

router.post('/', (req, res) => {
  const { lot_id, tenant_id, reading_date, previous_reading, current_reading, photo } = req.body;
  const rate = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
  const ratePerKwh = parseFloat(rate?.value || 0.15);
  const kwh = current_reading - previous_reading;
  const charge = +(kwh * ratePerKwh).toFixed(2);

  const result = db.prepare(`
    INSERT INTO meter_readings (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh, ratePerKwh, charge);

  // Save photo to disk (not in DB) to keep the database lean.
  let photoFile = null;
  if (photo) {
    photoFile = savePhoto(result.lastInsertRowid, photo);
    db.prepare('UPDATE meter_readings SET photo = ? WHERE id = ?').run(photoFile, result.lastInsertRowid);
  }
  res.json({ id: result.lastInsertRowid, kwh_used: kwh, electric_charge: charge, photo: photoFile });
});

router.put('/:id', (req, res) => {
  const { previous_reading, current_reading, reading_date, photo } = req.body;
  const rate = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
  const ratePerKwh = parseFloat(rate?.value || 0.15);
  const kwh = current_reading - previous_reading;
  const charge = +(kwh * ratePerKwh).toFixed(2);

  db.prepare(`
    UPDATE meter_readings SET previous_reading=?, current_reading=?, reading_date=?, kwh_used=?, rate_per_kwh=?, electric_charge=?
    WHERE id = ?
  `).run(previous_reading, current_reading, reading_date, kwh, ratePerKwh, charge, req.params.id);

  if (photo !== undefined) {
    const photoFile = savePhoto(req.params.id, photo);
    db.prepare('UPDATE meter_readings SET photo = ? WHERE id = ?').run(photoFile, req.params.id);
  }
  res.json({ success: true });
});

// Serve a meter reading photo from disk (or from DB for legacy base64 data).
router.get('/:id/photo', (req, res) => {
  const row = db.prepare('SELECT photo FROM meter_readings WHERE id = ?').get(req.params.id);
  if (!row?.photo) return res.status(404).json({ error: 'No photo for this reading' });

  // New style: photo column holds a filename on disk.
  const filepath = path.join(PHOTOS_DIR, row.photo);
  if (fs.existsSync(filepath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return fs.createReadStream(filepath).pipe(res);
  }

  // Legacy fallback: photo column holds raw base64 data.
  try {
    const buf = Buffer.from(row.photo, 'base64');
    if (buf.length > 100) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(buf);
    }
  } catch {}

  res.status(404).json({ error: 'Photo file not found' });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM meter_readings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
