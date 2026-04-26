/*
 * Anahuac RV Park — Bird Sightings
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

// Public: recent sightings
router.get('/public', (req, res) => {
  var rows = db.prepare(`
    SELECT s.id, s.bird_name, s.location, s.spotted_date, s.spotted_time, s.rarity,
      s.notes, s.likes_count, s.is_featured, s.created_at,
      CASE WHEN s.photo_data IS NOT NULL AND s.photo_data != '' THEN 1 ELSE 0 END as has_photo,
      CASE WHEN s.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as author,
      CASE WHEN s.tenant_id IS NULL THEN '' ELSE 'Lot ' || COALESCE(t.lot_id, '') END as author_lot
    FROM bird_sightings s LEFT JOIN tenants t ON s.tenant_id = t.id
    ORDER BY s.is_featured DESC, s.created_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

// Public: photo
router.get('/:id/photo', (req, res) => {
  var row = db.prepare('SELECT photo_data FROM bird_sightings WHERE id=?').get(req.params.id);
  if (!row || !row.photo_data) return res.status(404).send('No photo');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(Buffer.from(row.photo_data, 'base64'));
});

// Public: like
router.post('/:id/like', (req, res) => {
  db.prepare('UPDATE bird_sightings SET likes_count = likes_count + 1 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Public: submit sighting
router.post('/submit', (req, res) => {
  var b = req.body || {};
  if (!b.bird_name) return res.status(400).json({ error: 'Bird name is required' });
  var result = db.prepare(`INSERT INTO bird_sightings
    (tenant_id, bird_name, location, spotted_date, spotted_time, rarity, photo_data, notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    b.tenant_id || null, b.bird_name, b.location || null,
    b.spotted_date || new Date().toISOString().split('T')[0],
    b.spotted_time || null, b.rarity || 'Common', b.photo_data || null, b.notes || null
  );
  res.json({ id: result.lastInsertRowid });
});

// Admin routes
router.use(authenticate);

router.get('/', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(db.prepare(`
    SELECT s.*, t.first_name, t.last_name, t.lot_id,
      CASE WHEN s.photo_data IS NOT NULL AND s.photo_data != '' THEN 1 ELSE 0 END as has_photo
    FROM bird_sightings s LEFT JOIN tenants t ON s.tenant_id = t.id
    ORDER BY s.created_at DESC
  `).all());
});

router.put('/:id/feature', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var cur = db.prepare('SELECT is_featured FROM bird_sightings WHERE id=?').get(req.params.id);
  db.prepare('UPDATE bird_sightings SET is_featured=? WHERE id=?').run(cur?.is_featured ? 0 : 1, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM bird_sightings WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// CSV export
router.get('/export/csv', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var rows = db.prepare(`SELECT s.bird_name, s.location, s.spotted_date, s.spotted_time, s.rarity, s.notes, s.likes_count,
    CASE WHEN s.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as posted_by
    FROM bird_sightings s LEFT JOIN tenants t ON s.tenant_id = t.id ORDER BY s.spotted_date DESC`).all();
  var esc = function(v) { var s = String(v == null ? '' : v); if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; };
  var lines = ['Bird Name,Location,Date,Time,Rarity,Notes,Likes,Posted By'];
  rows.forEach(function(r) { lines.push([r.bird_name,r.location,r.spotted_date,r.spotted_time,r.rarity,r.notes,r.likes_count,r.posted_by].map(esc).join(',')); });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bird-sightings.csv"');
  res.send(lines.join('\n') + '\n');
});

module.exports = router;
