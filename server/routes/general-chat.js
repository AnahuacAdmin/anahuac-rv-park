/*
 * Anahuac RV Park — General Chat
 * Community chat with categories, reactions, comments, management posts
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');
const pushService = require('../services/push-notifications');

const REACTION_TYPES = ['thumbsup', 'heart', 'laugh', 'party'];
const CATEGORIES = ['general', 'question', 'good_news', 'announcement', 'tip', 'trade'];
const MAX_PHOTO_SIZE = 14_000_000;

// Attach reaction counts to posts
function attachReactions(posts) {
  if (!posts.length) return posts;
  const ids = posts.map(p => p.id);
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT post_id, reaction_type, COUNT(*) as c FROM general_chat_reactions WHERE post_id IN (${ph}) GROUP BY post_id, reaction_type`).all(...ids);
  const map = {};
  rows.forEach(r => {
    if (!map[r.post_id]) map[r.post_id] = {};
    map[r.post_id][r.reaction_type] = r.c;
  });
  posts.forEach(p => { p.reactions = map[p.id] || {}; });
  return posts;
}

// ── Public: list posts ──
router.get('/public', (req, res) => {
  var cat = req.query.category || '';
  var conditions = [];
  var params = [];
  if (cat && CATEGORIES.includes(cat)) { conditions.push('p.category = ?'); params.push(cat); }
  var where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  var posts = db.prepare(`SELECT p.id, p.category, p.message, p.is_management, p.is_pinned, p.created_at,
    CASE WHEN p.photo_data IS NOT NULL AND p.photo_data != '' THEN 1 ELSE 0 END as has_photo,
    CASE WHEN p.is_management = 1 THEN 'Park Management'
         WHEN p.tenant_id IS NULL THEN 'Visitor'
         ELSE t.first_name END as author_first,
    CASE WHEN p.is_management = 1 THEN 'Park Management'
         WHEN p.tenant_id IS NULL THEN 'Visitor'
         ELSE t.first_name || ' ' || t.last_name END as author,
    CASE WHEN p.is_management = 1 THEN ''
         WHEN p.tenant_id IS NULL THEN ''
         ELSE COALESCE('Lot ' || t.lot_id, '') END as author_lot,
    p.tenant_id,
    (SELECT COUNT(*) FROM general_chat_comments WHERE post_id=p.id) as comment_count
    FROM general_chat_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    ${where} ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 50`).all(...params);
  attachReactions(posts);
  res.json(posts);
});

// ── Public: photo ──
router.get('/:id/photo', (req, res) => {
  var row = db.prepare('SELECT photo_data FROM general_chat_posts WHERE id=?').get(parseInt(req.params.id));
  if (!row || !row.photo_data) return res.status(404).send('No photo');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(Buffer.from(row.photo_data, 'base64'));
});

// ── Public: submit post ──
router.post('/submit', (req, res) => {
  var b = req.body || {};
  if (!b.message || !b.message.trim()) return res.status(400).json({ error: 'Message is required' });
  if (b.message.length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
  var cat = CATEGORIES.includes(b.category) ? b.category : 'general';
  if (cat === 'announcement') cat = 'general'; // only admin can post announcements
  var photo = b.photo_data || null;
  if (photo && photo.length > MAX_PHOTO_SIZE) return res.status(400).json({ error: 'Photo too large' });
  var result = db.prepare('INSERT INTO general_chat_posts (tenant_id, category, message, photo_data) VALUES (?,?,?,?)').run(
    b.tenant_id || null, cat, b.message.trim(), photo
  );
  // Notify admin of new community post
  try { pushService.notifyAdmin({ type: 'community', title: '\ud83d\udcac New community post', body: b.message.trim().substring(0, 100), url: '/', priority: 'normal' }); } catch {}
  res.json({ id: result.lastInsertRowid });
});

// ── Public: toggle reaction ──
router.post('/:id/react', (req, res) => {
  var postId = parseInt(req.params.id);
  var { reaction_type, tenant_id } = req.body || {};
  if (!REACTION_TYPES.includes(reaction_type)) return res.status(400).json({ error: 'Invalid reaction type' });
  if (!tenant_id) return res.status(400).json({ error: 'tenant_id required' });
  var existing = db.prepare('SELECT id FROM general_chat_reactions WHERE post_id=? AND tenant_id=? AND reaction_type=?').get(postId, tenant_id, reaction_type);
  if (existing) {
    db.prepare('DELETE FROM general_chat_reactions WHERE id=?').run(existing.id);
    res.json({ toggled: 'removed' });
  } else {
    db.prepare('INSERT INTO general_chat_reactions (post_id, tenant_id, reaction_type) VALUES (?,?,?)').run(postId, tenant_id, reaction_type);
    res.json({ toggled: 'added' });
  }
});

// ── Public: my reactions ──
router.get('/my-reactions', (req, res) => {
  var tenantId = parseInt(req.query.tenant_id);
  if (!tenantId) return res.json({});
  var rows = db.prepare('SELECT post_id, reaction_type FROM general_chat_reactions WHERE tenant_id=?').all(tenantId);
  var map = {};
  rows.forEach(r => { if (!map[r.post_id]) map[r.post_id] = []; map[r.post_id].push(r.reaction_type); });
  res.json(map);
});

// ── Public: get comments ──
router.get('/:id/comments', (req, res) => {
  var comments = db.prepare(`SELECT c.id, c.comment, c.created_at,
    COALESCE(c.is_management, 0) as is_management,
    CASE WHEN COALESCE(c.is_management, 0) = 1 THEN 'Park Management'
         ELSE COALESCE(c.author_name, t.first_name || ' ' || t.last_name, 'Visitor') END as author,
    CASE WHEN COALESCE(c.is_management, 0) = 1 THEN ''
         ELSE COALESCE('Lot ' || t.lot_id, '') END as author_lot
    FROM general_chat_comments c LEFT JOIN tenants t ON c.tenant_id = t.id
    WHERE c.post_id=? ORDER BY c.created_at ASC`).all(parseInt(req.params.id));
  res.json(comments);
});

// ── Public: add comment ──
router.post('/:id/comments', (req, res) => {
  var postId = parseInt(req.params.id);
  var { comment, tenant_id, author_name } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment is required' });
  if (comment.length > 500) return res.status(400).json({ error: 'Comment too long' });
  db.prepare('INSERT INTO general_chat_comments (post_id, tenant_id, author_name, comment) VALUES (?,?,?,?)').run(
    postId, tenant_id || null, author_name || null, comment.trim()
  );
  // Notify post author about the comment
  try {
    var post = db.prepare('SELECT tenant_id FROM general_chat_posts WHERE id = ?').get(postId);
    if (post && post.tenant_id && post.tenant_id !== tenant_id) {
      pushService.notifyTenant(post.tenant_id, { type: 'comment', title: '\ud83d\udcac ' + (author_name || 'Someone') + ' commented on your post', body: comment.trim().substring(0, 100), url: '/portal', priority: 'normal' });
    }
  } catch {}
  res.json({ success: true });
});

// ── Public: reaction details (who reacted) ──
router.get('/:id/reactions', (req, res) => {
  var postId = parseInt(req.params.id);
  var rows = db.prepare(`SELECT cr.reaction_type,
    CASE WHEN cr.tenant_id = -1 THEN 'Park Management'
         WHEN cr.tenant_id IS NULL THEN 'Visitor'
         ELSE t.first_name END as name,
    CASE WHEN cr.tenant_id = -1 THEN ''
         WHEN cr.tenant_id IS NULL THEN ''
         ELSE COALESCE('Lot ' || t.lot_id, '') END as lot
    FROM general_chat_reactions cr LEFT JOIN tenants t ON cr.tenant_id = t.id
    WHERE cr.post_id=? ORDER BY cr.created_at ASC`).all(postId);
  var grouped = {};
  REACTION_TYPES.forEach(rt => { grouped[rt] = []; });
  rows.forEach(r => { if (grouped[r.reaction_type]) grouped[r.reaction_type].push({ name: r.name || 'Someone', lot: r.lot || '' }); });
  res.json(grouped);
});

// ══════ Admin routes ══════
router.use(authenticate);

// Admin: post with management badge
router.post('/admin-post', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  if (!b.message || !b.message.trim()) return res.status(400).json({ error: 'Message required' });
  var cat = CATEGORIES.includes(b.category) ? b.category : 'general';
  var photo = b.photo_data || null;
  var result = db.prepare('INSERT INTO general_chat_posts (tenant_id, category, message, photo_data, is_management, is_pinned) VALUES (?,?,?,?,1,?)').run(
    null, cat, b.message.trim(), photo, b.is_pinned ? 1 : 0
  );
  res.json({ id: result.lastInsertRowid });
});

// Admin: pin/unpin
router.post('/:id/pin', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var post = db.prepare('SELECT is_pinned FROM general_chat_posts WHERE id=?').get(parseInt(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE general_chat_posts SET is_pinned = ? WHERE id=?').run(post.is_pinned ? 0 : 1, parseInt(req.params.id));
  res.json({ pinned: !post.is_pinned });
});

// Admin: delete post
router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var postId = parseInt(req.params.id);
  db.prepare('DELETE FROM general_chat_comments WHERE post_id=?').run(postId);
  db.prepare('DELETE FROM general_chat_reactions WHERE post_id=?').run(postId);
  db.prepare('DELETE FROM general_chat_posts WHERE id=?').run(postId);
  res.json({ success: true });
});

// Admin: comment with management badge
router.post('/:id/comments/admin', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var { comment } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment required' });
  db.prepare('INSERT INTO general_chat_comments (post_id, comment, is_management) VALUES (?,?,1)').run(
    parseInt(req.params.id), comment.trim()
  );
  res.json({ success: true });
});

module.exports = router;
