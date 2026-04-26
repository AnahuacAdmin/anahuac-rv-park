/*
 * Anahuac RV Park — Hunting & Fishing Brag Board
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

// Public: recent posts
router.get('/public', (req, res) => {
  var type = req.query.type || '';
  var sql = `SELECT p.id, p.post_type, p.species, p.weight_lbs, p.weight_oz, p.length_inches,
    p.location, p.method, p.bait_used, p.description, p.likes_count,
    p.is_featured, p.is_biggest_of_month, p.created_at,
    CASE WHEN p.photo_data IS NOT NULL AND p.photo_data != '' THEN 1 ELSE 0 END as has_photo,
    CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as author,
    CASE WHEN p.tenant_id IS NULL THEN '' ELSE 'Lot ' || COALESCE(t.lot_id, '') END as author_lot
    FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id`;
  var params = [];
  if (type === 'fishing' || type === 'hunting') { sql += ' WHERE p.post_type=?'; params.push(type); }
  sql += ' ORDER BY p.is_featured DESC, p.created_at DESC LIMIT 50';
  res.json(db.prepare(sql).all(...params));
});

// Public: photo
router.get('/:id/photo', (req, res) => {
  var row = db.prepare('SELECT photo_data FROM hunting_fishing_posts WHERE id=?').get(req.params.id);
  if (!row || !row.photo_data) return res.status(404).send('No photo');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(Buffer.from(row.photo_data, 'base64'));
});

// Public: like
router.post('/:id/like', (req, res) => {
  db.prepare('UPDATE hunting_fishing_posts SET likes_count = likes_count + 1 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Public: submit
router.post('/submit', (req, res) => {
  var b = req.body || {};
  if (!b.species) return res.status(400).json({ error: 'Species/game type is required' });
  if (!b.photo_data) return res.status(400).json({ error: 'Photo is required' });
  var result = db.prepare(`INSERT INTO hunting_fishing_posts
    (tenant_id, post_type, species, weight_lbs, weight_oz, length_inches,
     location, method, bait_used, photo_data, description)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.tenant_id || null, b.post_type || 'fishing', b.species,
    Number(b.weight_lbs) || 0, Number(b.weight_oz) || 0, Number(b.length_inches) || 0,
    b.location || null, b.method || null, b.bait_used || null,
    b.photo_data, b.description || null
  );
  res.json({ id: result.lastInsertRowid });
});

// Public: leaderboard
router.get('/leaderboard', (req, res) => {
  var month = new Date().toISOString().slice(0, 7);
  var biggestBass = db.prepare(`SELECT p.species, p.weight_lbs, p.weight_oz, p.length_inches,
    CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as author
    FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE p.post_type='fishing' AND p.created_at LIKE ? AND p.species LIKE '%Bass%'
    ORDER BY (p.weight_lbs + p.weight_oz/16.0) DESC LIMIT 1`).get(month + '%');
  var mostCatches = db.prepare(`SELECT COUNT(*) as c,
    CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as author
    FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE p.post_type='fishing' AND p.created_at LIKE ?
    GROUP BY p.tenant_id ORDER BY c DESC LIMIT 1`).get(month + '%');
  var mostActive = db.prepare(`SELECT COUNT(*) as c,
    CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as author
    FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE p.created_at LIKE ? GROUP BY p.tenant_id ORDER BY c DESC LIMIT 1`).get(month + '%');
  res.json({ biggestBass, mostCatches, mostActive });
});

// Admin routes
router.use(authenticate);

router.get('/', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(db.prepare(`SELECT p.*, t.first_name, t.last_name, t.lot_id,
    CASE WHEN p.photo_data IS NOT NULL AND p.photo_data != '' THEN 1 ELSE 0 END as has_photo
    FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    ORDER BY p.created_at DESC`).all());
});

router.put('/:id/feature', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var cur = db.prepare('SELECT is_featured FROM hunting_fishing_posts WHERE id=?').get(req.params.id);
  db.prepare('UPDATE hunting_fishing_posts SET is_featured=? WHERE id=?').run(cur?.is_featured ? 0 : 1, req.params.id);
  res.json({ success: true });
});

router.put('/:id/biggest', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var cur = db.prepare('SELECT is_biggest_of_month FROM hunting_fishing_posts WHERE id=?').get(req.params.id);
  db.prepare('UPDATE hunting_fishing_posts SET is_biggest_of_month=? WHERE id=?').run(cur?.is_biggest_of_month ? 0 : 1, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM hunting_fishing_posts WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
