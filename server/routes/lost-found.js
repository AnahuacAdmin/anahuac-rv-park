/*
 * Anahuac RV Park — Lost & Found Pets
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

// Public: get active posts (for portal) — no tenant names exposed
router.get('/public', (req, res) => {
  var rows = db.prepare(`
    SELECT p.id, p.type, p.pet_type, p.pet_name, p.breed, p.color_description,
      p.last_seen_location, p.date_occurred, p.details, p.status,
      p.created_at, p.reunited_at,
      CASE WHEN p.photo_data IS NOT NULL AND p.photo_data != '' THEN 1 ELSE 0 END as has_photo,
      (SELECT COUNT(*) FROM lost_found_pet_comments WHERE post_id=p.id) as comment_count
    FROM lost_found_pets p
    WHERE p.status IN ('active', 'reunited')
      AND p.created_at >= datetime('now', '-30 days')
    ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END, p.created_at DESC
  `).all();
  // Replace any tenant contact info with office number
  rows.forEach(r => { r.contact_phone = '409-267-6603'; });
  res.json(rows);
});

// Public: get photo
router.get('/:id/photo', (req, res) => {
  var row = db.prepare('SELECT photo_data FROM lost_found_pets WHERE id=?').get(req.params.id);
  if (!row || !row.photo_data) return res.status(404).send('No photo');
  var buf = Buffer.from(row.photo_data, 'base64');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(buf);
});

// Public: submit a post (from portal tenant)
router.post('/submit', (req, res) => {
  var b = req.body || {};
  if (!b.type || !b.pet_type) return res.status(400).json({ error: 'Type and pet type are required' });
  if (!b.photo_data) return res.status(400).json({ error: 'A photo is required' });
  var result = db.prepare(`INSERT INTO lost_found_pets
    (tenant_id, type, pet_type, pet_name, breed, color_description,
     last_seen_location, date_occurred, photo_data, contact_phone, details)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.tenant_id || null, b.type, b.pet_type, b.pet_name || null, b.breed || null,
    b.color_description || null, b.last_seen_location || null,
    b.date_occurred || new Date().toISOString().split('T')[0],
    b.photo_data, b.contact_phone || null, b.details || null
  );
  res.json({ id: result.lastInsertRowid });
});

// Public: mark as reunited
router.post('/:id/reunite', (req, res) => {
  db.prepare("UPDATE lost_found_pets SET status='reunited', reunited_at=datetime('now') WHERE id=? AND status='active'").run(req.params.id);
  res.json({ success: true });
});

// Public: get comments
router.get('/:id/comments', (req, res) => {
  var comments = db.prepare(`SELECT c.id, c.comment, c.created_at,
    COALESCE(c.is_management, 0) as is_management,
    CASE WHEN COALESCE(c.is_management, 0) = 1 THEN 'Park Management'
         ELSE COALESCE(c.author_name, t.first_name || ' ' || t.last_name, 'Visitor') END as author,
    CASE WHEN COALESCE(c.is_management, 0) = 1 THEN ''
         ELSE COALESCE('Lot ' || t.lot_id, '') END as author_lot
    FROM lost_found_pet_comments c LEFT JOIN tenants t ON c.tenant_id = t.id
    WHERE c.post_id=? ORDER BY c.created_at ASC`).all(parseInt(req.params.id));
  res.json(comments);
});

// Public: add comment
router.post('/:id/comments', (req, res) => {
  var postId = parseInt(req.params.id);
  var { comment, tenant_id, author_name } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment is required' });
  if (comment.length > 500) return res.status(400).json({ error: 'Comment too long (max 500 chars)' });
  db.prepare('INSERT INTO lost_found_pet_comments (post_id, tenant_id, author_name, comment) VALUES (?,?,?,?)').run(
    postId, tenant_id || null, author_name || null, comment.trim()
  );
  res.json({ success: true });
});

// Admin routes
router.use(authenticate);

// Admin: all posts including archived
router.get('/', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var q = req.query;
  var sql = `SELECT p.id, p.type, p.pet_type, p.pet_name, p.breed, p.color_description,
    p.last_seen_location, p.date_occurred, p.contact_phone, p.details, p.status,
    p.created_at, p.reunited_at,
    CASE WHEN p.photo_data IS NOT NULL AND p.photo_data != '' THEN 1 ELSE 0 END as has_photo,
    (SELECT COUNT(*) FROM lost_found_pet_comments WHERE post_id=p.id) as comment_count,
    t.first_name, t.last_name, t.lot_id
    FROM lost_found_pets p
    LEFT JOIN tenants t ON p.tenant_id = t.id WHERE 1=1`;
  var params = [];
  if (q.status && q.status !== 'all') { sql += ' AND p.status=?'; params.push(q.status); }
  sql += ' ORDER BY p.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Admin: delete
router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var id = parseInt(req.params.id);
  db.prepare('DELETE FROM lost_found_pet_comments WHERE post_id=?').run(id);
  db.prepare('DELETE FROM lost_found_pets WHERE id=?').run(id);
  res.json({ success: true });
});

// Admin: update status
router.put('/:id/status', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var status = req.body?.status;
  if (!['active', 'reunited', 'archived'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  var extra = status === 'reunited' ? ", reunited_at=datetime('now')" : '';
  db.prepare('UPDATE lost_found_pets SET status=?' + extra + ' WHERE id=?').run(status, req.params.id);
  res.json({ success: true });
});

// Admin: comment on a lost & found post (as Park Management)
router.post('/:id/comments/admin', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var postId = parseInt(req.params.id);
  var { comment } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment is required' });
  if (comment.length > 500) return res.status(400).json({ error: 'Comment too long (max 500 chars)' });
  db.prepare('INSERT INTO lost_found_pet_comments (post_id, tenant_id, author_name, comment, is_management) VALUES (?,NULL,?,?,1)')
    .run(postId, req.user.username || 'Park Management', comment.trim());
  res.json({ success: true });
});

module.exports = router;
