/*
 * Anahuac RV Park — Local Restaurants ("Local Eats")
 * Public listing + Admin CRUD
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

// ── Public: list active restaurants ──
router.get('/public', (req, res) => {
  try {
    var rows = db.prepare(`SELECT id, name, category, cuisine_type, address, city, phone, website, hours,
      price_level, description, rating, distance_miles, has_delivery, has_takeout, has_dine_in,
      notable_for, is_recommended, display_order
      FROM local_restaurants WHERE is_active=1 ORDER BY display_order ASC, name ASC`).all();
    res.json(rows || []);
  } catch (e) {
    res.json([]);
  }
});

// ══════ Admin routes ══════
router.use(authenticate);

// Admin: list all (including inactive)
router.get('/admin', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var rows = db.prepare('SELECT * FROM local_restaurants ORDER BY display_order ASC, name ASC').all();
  res.json(rows || []);
});

// Admin: add restaurant
router.post('/add', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Restaurant name required' });
  var result = db.prepare(`INSERT INTO local_restaurants
    (name, category, cuisine_type, address, city, phone, website, hours, price_level,
     description, rating, distance_miles, has_delivery, has_takeout, has_dine_in,
     notable_for, is_recommended, display_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.name, b.category || 'american', b.cuisine_type || '', b.address || '', b.city || 'Anahuac',
    b.phone || '', b.website || '', b.hours || '', b.price_level || '$',
    b.description || '', parseFloat(b.rating) || 0, parseFloat(b.distance_miles) || 0,
    b.has_delivery ? 1 : 0, b.has_takeout !== false ? 1 : 0, b.has_dine_in !== false ? 1 : 0,
    b.notable_for || '', b.is_recommended ? 1 : 0, parseInt(b.display_order) || 0
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

// Admin: update restaurant
router.post('/:id/update', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  var id = parseInt(req.params.id);
  db.prepare(`UPDATE local_restaurants SET
    name=?, category=?, cuisine_type=?, address=?, city=?, phone=?, website=?, hours=?, price_level=?,
    description=?, rating=?, distance_miles=?, has_delivery=?, has_takeout=?, has_dine_in=?,
    notable_for=?, is_recommended=?, display_order=?, is_active=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).run(
    b.name, b.category, b.cuisine_type, b.address, b.city, b.phone, b.website, b.hours, b.price_level,
    b.description, parseFloat(b.rating) || 0, parseFloat(b.distance_miles) || 0,
    b.has_delivery ? 1 : 0, b.has_takeout ? 1 : 0, b.has_dine_in ? 1 : 0,
    b.notable_for, b.is_recommended ? 1 : 0, parseInt(b.display_order) || 0,
    b.is_active !== false ? 1 : 0, id
  );
  res.json({ success: true });
});

// Admin: delete (deactivate)
router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('UPDATE local_restaurants SET is_active=0 WHERE id=?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// Admin: toggle recommended
router.post('/:id/recommend', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var id = parseInt(req.params.id);
  var current = db.prepare('SELECT is_recommended FROM local_restaurants WHERE id=?').get(id);
  db.prepare('UPDATE local_restaurants SET is_recommended=? WHERE id=?').run(current?.is_recommended ? 0 : 1, id);
  res.json({ success: true, is_recommended: !current?.is_recommended });
});

module.exports = router;
