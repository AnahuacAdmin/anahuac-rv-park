/*
 * Anahuac RV Park — Local Eats
 * Public listing with community voting & menu comments + Admin CRUD
 */
const router = require('express').Router();
const { db, saveDb } = require('../database');
const { authenticate } = require('../middleware');

// ── Public: list active restaurants with vote stats ──
router.get('/public', (req, res) => {
  try {
    var rows = db.prepare(`SELECT id, name, emoji, category, cuisine_type, address, city, phone, website,
      is_recommended, display_order
      FROM local_restaurants WHERE is_active=1 ORDER BY display_order ASC, name ASC`).all();
    // Attach vote stats + menu comment count to each
    rows.forEach(function(r) {
      var vs = db.prepare('SELECT COUNT(*) as cnt, COALESCE(AVG(stars),0) as avg FROM restaurant_votes WHERE restaurant_id=?').get(r.id);
      r.vote_count = vs?.cnt || 0;
      r.vote_avg = vs?.avg ? Math.round(vs.avg * 10) / 10 : 0;
      var mc = db.prepare(`SELECT COUNT(*) as cnt FROM restaurant_menu_comments c
        JOIN restaurant_menu_items m ON c.menu_item_id=m.id WHERE m.restaurant_id=?`).get(r.id);
      r.comment_count = mc?.cnt || 0;
    });
    res.json(rows || []);
  } catch (e) {
    console.error('[local-eats] public list error:', e.message);
    res.json([]);
  }
});

// ── Tenant-authenticated routes ──

// Get my vote for a restaurant
router.get('/:id/my-vote', authenticate, (req, res) => {
  if (req.user?.role !== 'tenant') return res.json({ vote: null });
  var vote = db.prepare('SELECT stars, review_text FROM restaurant_votes WHERE restaurant_id=? AND tenant_id=?')
    .get(parseInt(req.params.id), req.user.id);
  res.json({ vote: vote || null });
});

// Submit or update vote (tenant only)
router.post('/:id/vote', authenticate, (req, res) => {
  if (req.user?.role !== 'tenant') return res.status(403).json({ error: 'Guests only' });
  var rid = parseInt(req.params.id);
  var stars = parseInt(req.body.stars);
  if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'Rating must be 1-5 stars' });
  var review = (req.body.review_text || '').trim().slice(0, 200);

  var existing = db.prepare('SELECT id FROM restaurant_votes WHERE restaurant_id=? AND tenant_id=?').get(rid, req.user.id);
  if (existing) {
    db.prepare('UPDATE restaurant_votes SET stars=?, review_text=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(stars, review, existing.id);
  } else {
    db.prepare('INSERT INTO restaurant_votes (restaurant_id, tenant_id, stars, review_text) VALUES (?,?,?,?)')
      .run(rid, req.user.id, stars, review);
  }
  saveDb();
  // Return updated stats
  var vs = db.prepare('SELECT COUNT(*) as cnt, COALESCE(AVG(stars),0) as avg FROM restaurant_votes WHERE restaurant_id=?').get(rid);
  res.json({ success: true, vote_count: vs?.cnt || 0, vote_avg: vs?.avg ? Math.round(vs.avg * 10) / 10 : 0 });
});

// Get menu items + comments for a restaurant
router.get('/:id/menu', (req, res) => {
  var rid = parseInt(req.params.id);
  var items = db.prepare('SELECT * FROM restaurant_menu_items WHERE restaurant_id=? ORDER BY is_pinned DESC, created_at ASC').all(rid);
  items.forEach(function(item) {
    item.comments = db.prepare('SELECT c.id, c.comment, c.first_name, c.lot_id, c.created_at FROM restaurant_menu_comments c WHERE c.menu_item_id=? ORDER BY c.created_at ASC').all(item.id);
  });
  res.json(items || []);
});

// Add a menu item (tenant or admin)
router.post('/:id/menu', authenticate, (req, res) => {
  var rid = parseInt(req.params.id);
  var name = (req.body.item_name || '').trim().slice(0, 150);
  var emoji = (req.body.item_emoji || '🍽️').slice(0, 10);
  if (!name) return res.status(400).json({ error: 'Item name required' });
  var tid = req.user.role === 'tenant' ? req.user.id : null;
  var result = db.prepare('INSERT INTO restaurant_menu_items (restaurant_id, added_by_tenant_id, item_emoji, item_name) VALUES (?,?,?,?)')
    .run(rid, tid, emoji, name);
  saveDb();
  res.json({ success: true, id: result.lastInsertRowid });
});

// Comment on a menu item
router.post('/menu/:itemId/comment', authenticate, (req, res) => {
  var itemId = parseInt(req.params.itemId);
  var comment = (req.body.comment || '').trim().slice(0, 200);
  if (!comment) return res.status(400).json({ error: 'Comment required' });
  var tid = req.user.role === 'tenant' ? req.user.id : null;
  // Get commenter display info
  var firstName = '', lotId = '';
  if (req.user.role === 'tenant') {
    var t = db.prepare('SELECT first_name, lot_id FROM tenants WHERE id=?').get(req.user.id);
    firstName = t?.first_name || '';
    lotId = t?.lot_id || '';
  } else {
    firstName = 'Management';
    lotId = '';
  }
  db.prepare('INSERT INTO restaurant_menu_comments (menu_item_id, tenant_id, comment, first_name, lot_id) VALUES (?,?,?,?,?)')
    .run(itemId, tid, comment, firstName, lotId);
  saveDb();
  res.json({ success: true });
});

// ══════ Admin routes ══════

// Admin: list all (including inactive)
router.get('/admin', authenticate, (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var rows = db.prepare('SELECT * FROM local_restaurants ORDER BY display_order ASC, name ASC').all();
  res.json(rows || []);
});

// Admin: add restaurant
router.post('/add', authenticate, (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Restaurant name required' });
  var maxOrder = db.prepare('SELECT COALESCE(MAX(display_order),0) as m FROM local_restaurants').get()?.m || 0;
  var result = db.prepare(`INSERT INTO local_restaurants
    (name, emoji, category, cuisine_type, address, city, phone, website, is_recommended, display_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    b.name.trim(), b.emoji || '🍽️', b.category || 'american', b.cuisine_type || '',
    b.address || '', b.city || 'Anahuac', b.phone || '', b.website || '',
    b.is_recommended ? 1 : 0, parseInt(b.display_order) || (maxOrder + 1)
  );
  saveDb();
  res.json({ success: true, id: result.lastInsertRowid });
});

// Admin: update restaurant
router.post('/:id/update', authenticate, (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  var id = parseInt(req.params.id);
  db.prepare(`UPDATE local_restaurants SET
    name=?, emoji=?, category=?, cuisine_type=?, address=?, city=?, phone=?, website=?,
    is_recommended=?, display_order=?, is_active=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).run(
    b.name, b.emoji || '🍽️', b.category || 'american', b.cuisine_type || '',
    b.address || '', b.city || 'Anahuac', b.phone || '', b.website || '',
    b.is_recommended ? 1 : 0, parseInt(b.display_order) || 0,
    b.is_active !== false ? 1 : 0, id
  );
  saveDb();
  res.json({ success: true });
});

// Admin: delete restaurant
router.delete('/:id', authenticate, (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var id = parseInt(req.params.id);
  db.prepare('DELETE FROM restaurant_menu_comments WHERE menu_item_id IN (SELECT id FROM restaurant_menu_items WHERE restaurant_id=?)').run(id);
  db.prepare('DELETE FROM restaurant_menu_items WHERE restaurant_id=?').run(id);
  db.prepare('DELETE FROM restaurant_votes WHERE restaurant_id=?').run(id);
  db.prepare('DELETE FROM local_restaurants WHERE id=?').run(id);
  saveDb();
  res.json({ success: true });
});

// Admin: reorder restaurants
router.post('/reorder', authenticate, (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var order = req.body.order; // array of ids in new order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  order.forEach(function(id, i) {
    db.prepare('UPDATE local_restaurants SET display_order=? WHERE id=?').run(i + 1, parseInt(id));
  });
  saveDb();
  res.json({ success: true });
});

// Admin: toggle recommended
router.post('/:id/recommend', authenticate, (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var id = parseInt(req.params.id);
  var current = db.prepare('SELECT is_recommended FROM local_restaurants WHERE id=?').get(id);
  db.prepare('UPDATE local_restaurants SET is_recommended=? WHERE id=?').run(current?.is_recommended ? 0 : 1, id);
  saveDb();
  res.json({ success: true, is_recommended: !current?.is_recommended });
});

// Admin: pin a menu item
router.post('/menu/:itemId/pin', authenticate, (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var item = db.prepare('SELECT is_pinned FROM restaurant_menu_items WHERE id=?').get(parseInt(req.params.itemId));
  db.prepare('UPDATE restaurant_menu_items SET is_pinned=? WHERE id=?').run(item?.is_pinned ? 0 : 1, parseInt(req.params.itemId));
  saveDb();
  res.json({ success: true });
});

// Admin: delete a menu item
router.delete('/menu/:itemId', authenticate, (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var itemId = parseInt(req.params.itemId);
  db.prepare('DELETE FROM restaurant_menu_comments WHERE menu_item_id=?').run(itemId);
  db.prepare('DELETE FROM restaurant_menu_items WHERE id=?').run(itemId);
  saveDb();
  res.json({ success: true });
});

module.exports = router;
