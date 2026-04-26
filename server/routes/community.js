/*
 * Anahuac RV Park — Community Board
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

// Public: approved posts for portal
router.get('/public', (req, res) => {
  var posts = db.prepare(`
    SELECT p.id, p.post_type, p.title, p.message, p.is_pinned, p.likes_count, p.submitted_at,
      COALESCE(p.reply_count, 0) as reply_count,
      CASE WHEN p.tenant_id IS NULL THEN 'Park Management' ELSE t.first_name || ' ' || t.last_name END as author,
      CASE WHEN p.tenant_id IS NULL THEN '' ELSE 'Lot ' || COALESCE(p.lot_id, t.lot_id, '') END as author_lot,
      CASE WHEN p.photo_data IS NOT NULL AND p.photo_data != '' THEN 1 ELSE 0 END as has_photo
    FROM community_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE p.status = 'approved'
    ORDER BY p.is_pinned DESC, p.submitted_at DESC LIMIT 20
  `).all();
  res.json(posts);
});

// Public: get photo for a post
router.get('/:id/photo', (req, res) => {
  var post = db.prepare('SELECT photo_data FROM community_posts WHERE id=? AND status=?').get(req.params.id, 'approved');
  if (!post || !post.photo_data) return res.status(404).send('No photo');
  var buf = Buffer.from(post.photo_data, 'base64');
  res.set('Content-Type', 'image/jpeg');
  res.send(buf);
});

// Public: like a post
router.post('/:id/like', (req, res) => {
  db.prepare('UPDATE community_posts SET likes_count = likes_count + 1 WHERE id=? AND status=?').run(req.params.id, 'approved');
  res.json({ success: true });
});

// Submit a post (tenant via portal)
router.post('/submit', (req, res) => {
  var b = req.body || {};
  if (!b.title && !b.message) return res.status(400).json({ error: 'Title or message required' });
  var result = db.prepare('INSERT INTO community_posts (tenant_id, lot_id, post_type, title, message, photo_data, status) VALUES (?,?,?,?,?,?,?)').run(
    b.tenant_id || null, b.lot_id || null, b.post_type || 'community', b.title || '', b.message || '', b.photo_data || null, 'pending'
  );
  // SMS to manager
  try {
    var mgrPhone = db.prepare("SELECT value FROM settings WHERE key='manager_phone'").get()?.value;
    if (mgrPhone) sendSms(mgrPhone, '📋 New community post from ' + (b.author_name || 'a tenant') + ': ' + (b.title || '').slice(0, 60));
  } catch {}
  res.json({ id: result.lastInsertRowid });
});

// Public: get replies for a post
router.get('/:id/replies', (req, res) => {
  var replies = db.prepare(`
    SELECT id, post_id, tenant_id, author_name, author_lot, is_management, message, created_at
    FROM community_replies WHERE post_id = ? ORDER BY created_at ASC
  `).all(req.params.id);
  res.json(replies);
});

// Public: add reply from portal tenant
router.post('/:id/replies', (req, res) => {
  var b = req.body || {};
  if (!b.message || !String(b.message).trim()) return res.status(400).json({ error: 'Message is required' });
  if (!b.author_name) return res.status(400).json({ error: 'Author name is required' });
  // Verify the post exists and is approved
  var post = db.prepare('SELECT id FROM community_posts WHERE id = ? AND status = ?').get(req.params.id, 'approved');
  if (!post) return res.status(404).json({ error: 'Post not found' });
  var result = db.prepare(
    'INSERT INTO community_replies (post_id, tenant_id, author_name, author_lot, is_management, message) VALUES (?,?,?,?,0,?)'
  ).run(req.params.id, b.tenant_id || null, String(b.author_name).trim(), b.author_lot || null, String(b.message).trim());
  db.prepare('UPDATE community_posts SET reply_count = (SELECT COUNT(*) FROM community_replies WHERE post_id = ?) WHERE id = ?').run(req.params.id, req.params.id);
  res.json({ id: result.lastInsertRowid });
});

// Admin routes
router.use(authenticate);

// Latest community activity — returns the single most recent event (post or reply)
// for the dashboard strip. Admin-only.
router.get('/latest-activity', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var latestPost = db.prepare(`
    SELECT p.id, p.title, p.submitted_at as ts,
      CASE WHEN p.tenant_id IS NULL THEN 'Park Management' ELSE t.first_name || ' ' || t.last_name END as author,
      CASE WHEN p.tenant_id IS NULL THEN '' ELSE 'Lot ' || COALESCE(p.lot_id, t.lot_id, '') END as author_lot
    FROM community_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE p.status = 'approved'
    ORDER BY p.submitted_at DESC LIMIT 1
  `).get();
  var latestReply = db.prepare(`
    SELECT r.id, r.author_name as author, r.author_lot, r.is_management, r.created_at as ts,
      p.id as post_id, p.title as post_title
    FROM community_replies r
    JOIN community_posts p ON r.post_id = p.id AND p.status = 'approved'
    ORDER BY r.created_at DESC LIMIT 1
  `).get();

  // Compare timestamps to determine which is more recent
  var postTs = latestPost?.ts || '';
  var replyTs = latestReply?.ts || '';
  if (!postTs && !replyTs) return res.json(null);

  if (replyTs > postTs && latestReply) {
    return res.json({
      type: 'reply',
      author: latestReply.author,
      author_lot: latestReply.author_lot,
      is_management: latestReply.is_management,
      post_title: latestReply.post_title,
      ts: latestReply.ts,
    });
  }
  return res.json({
    type: 'post',
    author: latestPost.author,
    author_lot: latestPost.author_lot,
    post_title: latestPost.title,
    ts: latestPost.ts,
  });
});

// All posts (admin) — includes reply_count
router.get('/', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(db.prepare(`
    SELECT p.*, COALESCE(p.reply_count, 0) as reply_count, t.first_name, t.last_name FROM community_posts p
    LEFT JOIN tenants t ON p.tenant_id = t.id
    ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, p.submitted_at DESC
  `).all());
});

// Approve
router.put('/:id/approve', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare("UPDATE community_posts SET status='approved', approved_at=datetime('now'), approved_by=? WHERE id=?").run(req.user.username, req.params.id);
  // SMS tenant
  try {
    var post = db.prepare('SELECT tenant_id FROM community_posts WHERE id=?').get(req.params.id);
    if (post?.tenant_id) {
      var tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id=?').get(post.tenant_id);
      if (tenant?.phone) await sendSms(tenant.phone, '🎉 ' + tenant.first_name + ', your community post has been approved and is now live on the portal!');
    }
  } catch {}
  res.json({ success: true });
});

// Reject
router.put('/:id/reject', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var reason = req.body?.reason || 'Does not meet community guidelines';
  db.prepare("UPDATE community_posts SET status='rejected', rejection_reason=? WHERE id=?").run(reason, req.params.id);
  try {
    var post = db.prepare('SELECT tenant_id FROM community_posts WHERE id=?').get(req.params.id);
    if (post?.tenant_id) {
      var tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id=?').get(post.tenant_id);
      if (tenant?.phone) await sendSms(tenant.phone, tenant.first_name + ', your community post was not approved. Reason: ' + reason + '. Questions? Call 409-267-6603');
    }
  } catch {}
  res.json({ success: true });
});

// Pin/unpin
router.put('/:id/pin', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var post = db.prepare('SELECT is_pinned FROM community_posts WHERE id=?').get(req.params.id);
  db.prepare('UPDATE community_posts SET is_pinned=? WHERE id=?').run(post?.is_pinned ? 0 : 1, req.params.id);
  res.json({ success: true });
});

// Admin create post (auto-approved)
router.post('/', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  var result = db.prepare("INSERT INTO community_posts (tenant_id, lot_id, post_type, title, message, photo_data, status, approved_at, approved_by) VALUES (?,?,?,?,?,?,'approved',datetime('now'),?)").run(
    b.tenant_id || null, b.lot_id || null, b.post_type || 'announcement', b.title || '', b.message || '', b.photo_data || null, req.user.username
  );
  // SMS recognized tenant if recognition post
  if (b.post_type === 'recognition' && b.tenant_id) {
    try {
      var tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id=?').get(b.tenant_id);
      if (tenant?.phone) sendSms(tenant.phone, '🏆 ' + tenant.first_name + ', you\'ve been recognized by Anahuac RV Park! Check the community board to see your shoutout!');
    } catch {}
  }
  res.json({ id: result.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM community_posts WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Admin reply (marked as management)
router.post('/:id/replies/admin', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var b = req.body || {};
  if (!b.message || !String(b.message).trim()) return res.status(400).json({ error: 'Message is required' });
  var post = db.prepare('SELECT id FROM community_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  var result = db.prepare(
    'INSERT INTO community_replies (post_id, tenant_id, author_name, author_lot, is_management, message) VALUES (?,?,?,?,1,?)'
  ).run(req.params.id, null, req.user.username || 'Management', null, String(b.message).trim());
  db.prepare('UPDATE community_posts SET reply_count = (SELECT COUNT(*) FROM community_replies WHERE post_id = ?) WHERE id = ?').run(req.params.id, req.params.id);
  res.json({ id: result.lastInsertRowid });
});

// Admin delete reply
router.delete('/replies/:replyId', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var reply = db.prepare('SELECT post_id FROM community_replies WHERE id = ?').get(req.params.replyId);
  db.prepare('DELETE FROM community_replies WHERE id = ?').run(req.params.replyId);
  if (reply) {
    db.prepare('UPDATE community_posts SET reply_count = (SELECT COUNT(*) FROM community_replies WHERE post_id = ?) WHERE id = ?').run(reply.post_id, reply.post_id);
  }
  res.json({ success: true });
});

module.exports = router;
