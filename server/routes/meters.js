/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { db, DB_PATH } = require('../database');
const { authenticate } = require('../middleware');
var checkElectricAnomalies;
try { checkElectricAnomalies = require('./electric-alerts').checkElectricAnomalies; } catch(e) { checkElectricAnomalies = function() {}; }

// Photos directory: next to the database on the Railway volume.
const PHOTOS_DIR = path.join(path.dirname(DB_PATH), 'uploads', 'meter-photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// Photo diagnostics — public (no auth), only shows counts
// Optional ?lot=A4 to see all readings for a specific lot
router.get('/photo-stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM meter_readings').get().cnt;
  const withPhoto = db.prepare("SELECT COUNT(*) as cnt FROM meter_readings WHERE photo IS NOT NULL AND photo != ''").get().cnt;
  // Use CDT (UTC-5) for "today" to match client-side dates
  const now = new Date();
  const cdt = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const today = cdt.toISOString().split('T')[0];
  const todayTotal = db.prepare('SELECT COUNT(*) as cnt FROM meter_readings WHERE reading_date = ?').get(today).cnt;
  const todayWithPhoto = db.prepare("SELECT COUNT(*) as cnt FROM meter_readings WHERE reading_date = ? AND photo IS NOT NULL AND photo != ''").get(today).cnt;
  const recentWithPhotos = db.prepare("SELECT id, lot_id, reading_date, photo FROM meter_readings WHERE photo IS NOT NULL AND photo != '' ORDER BY id DESC LIMIT 10").all();
  recentWithPhotos.forEach(r => {
    r.file_exists = fs.existsSync(path.join(PHOTOS_DIR, r.photo || ''));
  });

  const result = { total, withPhoto, todayTotal, todayWithPhoto, todayDate: today, photosDir: PHOTOS_DIR, recentWithPhotos };

  // Lot-specific query: /photo-stats?lot=A4
  const lotFilter = req.query.lot;
  if (lotFilter) {
    result.lotReadings = db.prepare(
      'SELECT id, lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, electric_charge, photo FROM meter_readings WHERE lot_id = ? ORDER BY id DESC'
    ).all(lotFilter);
    result.lotReadings.forEach(r => {
      r.photo_file_exists = r.photo ? fs.existsSync(path.join(PHOTOS_DIR, r.photo)) : null;
    });
  }

  // List all photo files on disk
  try {
    const diskFiles = fs.readdirSync(PHOTOS_DIR);
    const dbPhotos = db.prepare("SELECT photo FROM meter_readings WHERE photo IS NOT NULL AND photo != ''").all().map(r => r.photo);
    result.diskFileCount = diskFiles.length;
    result.orphanedFiles = diskFiles.filter(f => !dbPhotos.includes(f));
  } catch (e) {
    result.diskError = e.message;
  }

  res.json(result);
});

// Serve meter photos — public (no auth) so <img> tags can load them directly
router.get('/:id/photo', (req, res) => {
  try {
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
  } catch (err) {
    console.error('[meters] photo serve error:', err);
    res.status(500).json({ error: 'Failed to serve photo' });
  }
});

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
  // Ensure every active tenant on an occupied lot has at least one meter reading.
  const today = new Date().toISOString().split('T')[0];
  const activeTenants = db.prepare(
    `SELECT id, lot_id FROM tenants WHERE is_active = 1 AND lot_id IS NOT NULL AND lot_id != ''`
  ).all();
  for (const t of activeTenants) {
    // Check if ANY reading exists for this lot (regardless of tenant_id)
    const existing = db.prepare(
      `SELECT id FROM meter_readings WHERE lot_id = ? LIMIT 1`
    ).get(t.lot_id);
    if (!existing) {
      db.prepare(`
        INSERT INTO meter_readings
          (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge)
        VALUES (?, ?, ?, 0, 0, 0, 0.15, 0)
      `).run(t.lot_id, t.id, today);
    }
  }

  // Build the readings list from ALL lots, showing the latest reading per lot.
  // For occupied lots with active tenants: show tenant name + latest reading.
  // For vacant/reserved lots: show lot with "(Vacant)" or "(Reserved)".
  const allLots = db.prepare('SELECT id, status FROM lots ORDER BY row_letter, lot_number').all();
  const results = [];

  for (const lot of allLots) {
    // Find the active tenant on this lot (if any)
    const tenant = db.prepare('SELECT id, first_name, last_name, monthly_rent, rent_type FROM tenants WHERE lot_id = ? AND is_active = 1 LIMIT 1').get(lot.id);

    // Find the latest meter reading for this lot — pick the highest id regardless of tenant_id,
    // so real readings (with photos/kwh) are never hidden behind zero-use placeholders.
    let reading = db.prepare('SELECT * FROM meter_readings WHERE lot_id = ? ORDER BY id DESC LIMIT 1').get(lot.id);
    // If there's a reading with actual usage, prefer it over a zero placeholder
    if (reading && reading.kwh_used === 0 && reading.current_reading === 0) {
      const realReading = db.prepare(
        'SELECT * FROM meter_readings WHERE lot_id = ? AND (kwh_used > 0 OR current_reading > 0) ORDER BY id DESC LIMIT 1'
      ).get(lot.id);
      if (realReading) reading = realReading;
    }

    // Find previous month's reading — must be from a DIFFERENT reading_date (different month).
    // Same-date readings are duplicates from this session, not a previous period.
    var prevReading = null;
    if (reading && reading.reading_date) {
      prevReading = db.prepare(
        `SELECT id, reading_date, previous_reading, current_reading, kwh_used, electric_charge, photo
         FROM meter_readings
         WHERE lot_id = ? AND id < ? AND reading_date != ?
         ORDER BY id DESC LIMIT 1`
      ).get(lot.id, reading.id, reading.reading_date);
    }

    results.push({
      id: reading?.id || 0,
      lot_id: lot.id,
      tenant_id: tenant?.id || reading?.tenant_id || null,
      first_name: tenant?.first_name || (lot.status === 'owner_reserved' ? '(Reserved)' : '(Vacant)'),
      last_name: tenant?.last_name || '',
      monthly_rent: tenant?.monthly_rent || 0,
      rent_type: tenant?.rent_type || '',
      reading_date: reading?.reading_date || null,
      previous_reading: reading?.previous_reading || 0,
      current_reading: reading?.current_reading || 0,
      kwh_used: reading?.kwh_used || 0,
      rate_per_kwh: reading?.rate_per_kwh || 0.15,
      electric_charge: reading?.electric_charge || 0,
      photo: reading?.photo || null,
      prev_id: prevReading?.id || null,
      prev_date: prevReading?.reading_date || null,
      prev_photo: prevReading?.photo || null,
      prev_kwh: prevReading?.kwh_used || null,
      prev_charge: prevReading?.electric_charge || null,
    });
  }

  const withPhotos = results.filter(r => r.photo).length;
  const withPrevPhotos = results.filter(r => r.prev_photo).length;
  console.log(`[meters/latest] Returning ${results.length} lots, ${withPhotos} with curr photo, ${withPrevPhotos} with prev photo`);
  // Debug: log duplicate readings for troubleshooting
  const debugLots = ['A2', 'A3'];
  for (const dl of debugLots) {
    const allForLot = db.prepare('SELECT id, lot_id, reading_date, current_reading, photo FROM meter_readings WHERE lot_id = ? ORDER BY id').all(dl);
    if (allForLot.length > 0) console.log(`[meters/debug] ${dl} readings:`, JSON.stringify(allForLot));
  }
  res.json(results);
});

const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5MB max

// Save a base64 photo to disk, return the filename.
function savePhoto(readingId, base64Data) {
  if (!base64Data) return null;
  if (base64Data.length > MAX_PHOTO_SIZE * 1.37) return null; // base64 is ~37% larger
  const filename = `meter-${readingId}.jpg`;
  const filepath = path.join(PHOTOS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
  return filename;
}

router.post('/', (req, res) => {
  const { lot_id, reading_date, previous_reading, current_reading, photo } = req.body;
  let { tenant_id } = req.body;
  if (photo) {
    console.log(`[meters] PHOTO RECEIVED: ${photo.length} chars (~${Math.round(photo.length * 0.75 / 1024)}KB) for lot ${lot_id}`);
  } else {
    console.log(`[meters] NO PHOTO IN REQUEST for lot ${lot_id}`);
  }
  // Always resolve tenant_id from the lot's current active tenant if not provided or null
  if (!tenant_id && lot_id) {
    const activeTenant = db.prepare('SELECT id FROM tenants WHERE lot_id = ? AND is_active = 1 LIMIT 1').get(lot_id);
    if (activeTenant) tenant_id = activeTenant.id;
  }
  const rate = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
  const ratePerKwh = parseFloat(rate?.value || 0.15);
  const kwh = current_reading - previous_reading;
  const charge = +(kwh * ratePerKwh).toFixed(2);

  const result = db.prepare(`
    INSERT INTO meter_readings (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lot_id, tenant_id || null, reading_date, previous_reading, current_reading, kwh, ratePerKwh, charge);

  // Save photo to disk (not in DB) to keep the database lean.
  let photoFile = null;
  if (photo) {
    photoFile = savePhoto(result.lastInsertRowid, photo);
    db.prepare('UPDATE meter_readings SET photo = ? WHERE id = ?').run(photoFile, result.lastInsertRowid);
  }
  // Check for electric anomalies
  try { checkElectricAnomalies(req.body.lot_id, req.body.tenant_id, kwh); } catch(e) {}
  res.json({ id: result.lastInsertRowid, kwh_used: kwh, electric_charge: charge, photo: photoFile });
});

router.put('/:id', (req, res) => {
  const { previous_reading, current_reading, reading_date, photo } = req.body;

  // Photo-only update (no reading data)
  if (photo !== undefined && previous_reading === undefined && current_reading === undefined) {
    // Empty string = delete photo
    if (photo === '' || photo === null) {
      const existing = db.prepare('SELECT photo FROM meter_readings WHERE id = ?').get(req.params.id);
      if (existing?.photo) {
        const filepath = path.join(PHOTOS_DIR, existing.photo);
        try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (e) { console.error('[meters] photo delete error:', e); }
      }
      db.prepare('UPDATE meter_readings SET photo = NULL WHERE id = ?').run(req.params.id);
      return res.json({ success: true, deleted: true });
    }
    const photoFile = savePhoto(req.params.id, photo);
    db.prepare('UPDATE meter_readings SET photo = ? WHERE id = ?').run(photoFile, req.params.id);
    return res.json({ success: true });
  }

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

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM meter_readings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
