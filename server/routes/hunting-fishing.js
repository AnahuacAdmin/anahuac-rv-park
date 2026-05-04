/*
 * Anahuac RV Park — Hunting & Fishing Brag Board
 * Multi-photo, reactions, comments, first-catch celebration
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

// ── Helpers ──
const REACTION_TYPES = ['fishing_pole', 'heart', 'fire', 'clap'];
const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 14_000_000; // ~10MB base64 ≈ 14M chars

function postQuery(where, orderBy, limit) {
  return `SELECT p.id, p.post_type, p.species, p.weight_lbs, p.weight_oz, p.length_inches,
    p.location, p.method, p.bait_used, p.description, p.likes_count,
    p.is_featured, p.is_biggest_of_month, p.is_first_catch, p.created_at,
    CASE WHEN p.photo_data IS NOT NULL AND p.photo_data != '' THEN 1 ELSE 0 END as has_photo,
    (SELECT COUNT(*) FROM catch_photos WHERE post_id=p.id) as extra_photo_count,
    CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name END as author_first,
    CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as author,
    CASE WHEN p.tenant_id IS NULL THEN '' ELSE 'Lot ' || COALESCE(t.lot_id, '') END as author_lot,
    p.tenant_id,
    (SELECT COUNT(*) FROM catch_comments WHERE post_id=p.id) as comment_count
    FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    ${where} ${orderBy} ${limit ? 'LIMIT ' + limit : ''}`;
}

// Attach reaction counts to posts
function attachReactions(posts) {
  if (!posts.length) return posts;
  const ids = posts.map(p => p.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT post_id, reaction_type, COUNT(*) as c FROM catch_reactions WHERE post_id IN (${placeholders}) GROUP BY post_id, reaction_type`).all(...ids);
  const map = {};
  rows.forEach(r => {
    if (!map[r.post_id]) map[r.post_id] = {};
    map[r.post_id][r.reaction_type] = r.c;
  });
  posts.forEach(p => { p.reactions = map[p.id] || {}; });
  return posts;
}

// ── Public: recent posts ──
router.get('/public', (req, res) => {
  var type = req.query.type || '';
  var sort = req.query.sort || 'latest';
  var filter = req.query.filter || '';
  var tenantId = req.query.tenant_id ? parseInt(req.query.tenant_id) : null;

  var where = '';
  var params = [];
  var conditions = [];

  if (type === 'fishing' || type === 'hunting') { conditions.push('p.post_type=?'); params.push(type); }
  if (filter === 'week') { conditions.push("p.created_at >= datetime('now', '-7 days')"); }
  else if (filter === 'month') { conditions.push("p.created_at >= datetime('now', '-30 days')"); }
  if (tenantId) { conditions.push('p.tenant_id=?'); params.push(tenantId); }

  if (conditions.length) where = 'WHERE ' + conditions.join(' AND ');

  var orderBy = 'ORDER BY p.is_featured DESC, p.created_at DESC';
  if (sort === 'popular') orderBy = 'ORDER BY (SELECT COUNT(*) FROM catch_reactions WHERE post_id=p.id) DESC, p.created_at DESC';
  else if (sort === 'biggest') orderBy = "ORDER BY (p.weight_lbs + p.weight_oz/16.0) DESC, p.created_at DESC";
  else if (sort === 'species') orderBy = 'ORDER BY p.species ASC, p.created_at DESC';

  var posts = db.prepare(postQuery(where, orderBy, 50)).all(...params);
  attachReactions(posts);
  res.json(posts);
});

// ── Public: single post detail ──
router.get('/:id/detail', (req, res) => {
  var post = db.prepare(postQuery('WHERE p.id=?', '', null)).get(parseInt(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  attachReactions([post]);
  // Include extra photo IDs
  post.extra_photos = db.prepare('SELECT id, display_order FROM catch_photos WHERE post_id=? ORDER BY display_order').all(post.id);
  res.json(post);
});

// ── Public: main photo ──
router.get('/:id/photo', (req, res) => {
  var row = db.prepare('SELECT photo_data FROM hunting_fishing_posts WHERE id=?').get(parseInt(req.params.id));
  if (!row || !row.photo_data) return res.status(404).send('No photo');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(Buffer.from(row.photo_data, 'base64'));
});

// ── Public: extra photo by catch_photos.id ──
router.get('/photo/:photoId', (req, res) => {
  var row = db.prepare('SELECT photo_data FROM catch_photos WHERE id=?').get(parseInt(req.params.photoId));
  if (!row || !row.photo_data) return res.status(404).send('No photo');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(Buffer.from(row.photo_data, 'base64'));
});

// ── Public: toggle reaction ──
router.post('/:id/react', (req, res) => {
  var postId = parseInt(req.params.id);
  var { reaction_type, tenant_id } = req.body || {};
  if (!REACTION_TYPES.includes(reaction_type)) return res.status(400).json({ error: 'Invalid reaction type' });
  if (!tenant_id) return res.status(400).json({ error: 'tenant_id required' });

  // Toggle: if exists remove, else add
  var existing = db.prepare('SELECT id FROM catch_reactions WHERE post_id=? AND tenant_id=? AND reaction_type=?').get(postId, tenant_id, reaction_type);
  if (existing) {
    db.prepare('DELETE FROM catch_reactions WHERE id=?').run(existing.id);
    res.json({ toggled: 'removed' });
  } else {
    db.prepare('INSERT INTO catch_reactions (post_id, tenant_id, reaction_type) VALUES (?,?,?)').run(postId, tenant_id, reaction_type);
    res.json({ toggled: 'added' });
  }
});

// ── Public: get user's reactions for a set of posts ──
router.get('/my-reactions', (req, res) => {
  var tenantId = parseInt(req.query.tenant_id);
  if (!tenantId) return res.json({});
  var rows = db.prepare('SELECT post_id, reaction_type FROM catch_reactions WHERE tenant_id=?').all(tenantId);
  var map = {};
  rows.forEach(r => {
    if (!map[r.post_id]) map[r.post_id] = [];
    map[r.post_id].push(r.reaction_type);
  });
  res.json(map);
});

// ── Public: legacy like (increments counter + adds heart reaction) ──
router.post('/:id/like', (req, res) => {
  db.prepare('UPDATE hunting_fishing_posts SET likes_count = likes_count + 1 WHERE id=?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// ── Public: get comments ──
router.get('/:id/comments', (req, res) => {
  var comments = db.prepare(`SELECT c.id, c.comment, c.created_at,
    COALESCE(c.is_management, 0) as is_management,
    CASE WHEN COALESCE(c.is_management, 0) = 1 THEN 'Park Management'
         ELSE COALESCE(c.author_name, t.first_name || ' ' || t.last_name, 'Visitor') END as author,
    CASE WHEN COALESCE(c.is_management, 0) = 1 THEN ''
         ELSE COALESCE('Lot ' || t.lot_id, '') END as author_lot
    FROM catch_comments c LEFT JOIN tenants t ON c.tenant_id = t.id
    WHERE c.post_id=? ORDER BY c.created_at ASC`).all(parseInt(req.params.id));
  res.json(comments);
});

// ── Public: add comment ──
router.post('/:id/comments', (req, res) => {
  var postId = parseInt(req.params.id);
  var { comment, tenant_id, author_name } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment is required' });
  if (comment.length > 500) return res.status(400).json({ error: 'Comment too long (max 500 chars)' });
  db.prepare('INSERT INTO catch_comments (post_id, tenant_id, author_name, comment) VALUES (?,?,?,?)').run(
    postId, tenant_id || null, author_name || null, comment.trim()
  );
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
    FROM catch_reactions cr LEFT JOIN tenants t ON cr.tenant_id = t.id
    WHERE cr.post_id=? ORDER BY cr.created_at ASC`).all(postId);
  // Group by reaction type
  var grouped = {};
  REACTION_TYPES.forEach(function(rt) { grouped[rt] = []; });
  rows.forEach(function(r) {
    if (grouped[r.reaction_type]) {
      grouped[r.reaction_type].push({ name: r.name || 'Someone', lot: r.lot || '' });
    }
  });
  res.json(grouped);
});

// ── Public: submit catch (multi-photo) ──
router.post('/submit', (req, res) => {
  var b = req.body || {};
  if (!b.species) return res.status(400).json({ error: 'Species/game type is required' });
  if (!b.photo_data && (!b.photos || !b.photos.length)) return res.status(400).json({ error: 'At least one photo is required' });

  // Determine if this is the first-ever catch (safe even if old posts exist from before upgrade)
  var existingFirstCatch = db.prepare('SELECT COUNT(*) as c FROM hunting_fishing_posts WHERE is_first_catch = 1').get().c;
  var isFirstCatch = existingFirstCatch === 0 ? 1 : 0;

  // Main photo: first from photos array or legacy photo_data
  var mainPhoto = b.photo_data || (b.photos && b.photos[0]) || null;
  if (mainPhoto && mainPhoto.length > MAX_PHOTO_SIZE) return res.status(400).json({ error: 'Photo too large (max 10MB)' });

  var result = db.prepare(`INSERT INTO hunting_fishing_posts
    (tenant_id, post_type, species, weight_lbs, weight_oz, length_inches,
     location, method, bait_used, photo_data, description, is_first_catch)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.tenant_id || null, b.post_type || 'fishing', b.species,
    Number(b.weight_lbs) || 0, Number(b.weight_oz) || 0, Number(b.length_inches) || 0,
    b.location || null, b.method || null, b.bait_used || null,
    mainPhoto, b.description || null, isFirstCatch
  );
  var postId = result.lastInsertRowid;

  // Extra photos (index 1+)
  if (b.photos && b.photos.length > 1) {
    var insertPhoto = db.prepare('INSERT INTO catch_photos (post_id, photo_data, display_order) VALUES (?,?,?)');
    for (var i = 1; i < Math.min(b.photos.length, MAX_PHOTOS); i++) {
      if (b.photos[i] && b.photos[i].length <= MAX_PHOTO_SIZE) {
        insertPhoto.run(postId, b.photos[i], i);
      }
    }
  }

  // Award first-catch badge
  if (isFirstCatch && b.tenant_id) {
    try {
      db.prepare('INSERT INTO tenant_badges (tenant_id, badge_type, badge_label) VALUES (?,?,?)').run(
        b.tenant_id, 'first_catch', 'Founding Angler — First Catch!'
      );
    } catch {}

    // Send park-wide email announcement (async, non-blocking)
    try {
      var tenant = db.prepare('SELECT first_name, last_name, lot_id FROM tenants WHERE id=?').get(b.tenant_id);
      if (tenant) {
        var name = tenant.first_name + (tenant.last_name ? ' ' + tenant.last_name : '');
        var lot = tenant.lot_id || '?';
        // Get all tenants who opted into email
        var allTenants = db.prepare("SELECT id, first_name, email, email_opt_in FROM tenants WHERE email IS NOT NULL AND email != '' AND email_opt_in = 1 AND is_active = 1").all();
        // Lazy-load resend
        try {
          var { Resend } = require('resend');
          var resendKey = process.env.RESEND_API_KEY;
          if (resendKey && allTenants.length) {
            var resend = new Resend(resendKey);
            allTenants.forEach(function(t) {
              resend.emails.send({
                from: 'Anahuac RV Park <management@anrvpark.com>',
                to: t.email,
                subject: 'We have our FIRST catch on the Anahuac RV Park Community!',
                html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
                  '<div style="background:#92400e;color:#fff;text-align:center;padding:20px;border-radius:12px 12px 0 0">' +
                    '<div style="font-size:32px">🎉🎣🏆🎣🎉</div>' +
                    '<h1 style="margin:8px 0 0;font-size:22px">FIRST CATCH!</h1>' +
                  '</div>' +
                  '<div style="background:#fffbeb;padding:20px;border:1px solid #fde68a;border-radius:0 0 12px 12px">' +
                    '<p style="font-size:16px;color:#1c1917;margin:0 0 12px">Hi ' + t.first_name + ',</p>' +
                    '<p style="font-size:16px;color:#1c1917;margin:0 0 12px">Big shoutout to <strong>' + name + '</strong> from <strong>Lot ' + lot + '</strong> for being the <em>first person</em> to share a catch on our new community page!</p>' +
                    '<p style="font-size:16px;color:#1c1917;margin:0 0 12px">They caught a <strong>' + (b.species || 'mystery fish') + '</strong>! 🐟</p>' +
                    '<p style="font-size:16px;color:#1c1917;margin:0 0 16px">Now it\'s YOUR turn — get out there, catch something, and share it!</p>' +
                    '<div style="text-align:center"><a href="https://anrvpark.com/portal" style="display:inline-block;background:#92400e;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px">Share Your Catch 🎣</a></div>' +
                  '</div>' +
                '</div>'
              }).catch(function() {});
            });
            console.log('[hunting-fishing] First catch email sent to', allTenants.length, 'residents');
          }
        } catch (emailErr) {
          console.warn('[hunting-fishing] Could not send first-catch emails:', emailErr.message);
        }
      }
    } catch (e) { console.warn('[hunting-fishing] First-catch badge/email error:', e.message); }
  }

  res.json({ id: postId, is_first_catch: !!isFirstCatch });
});

// ── Public: check first-catch status ──
router.get('/first-catch-status', (req, res) => {
  var total = db.prepare('SELECT COUNT(*) as c FROM hunting_fishing_posts').get().c;
  var firstCatch = null;
  if (total > 0) {
    firstCatch = db.prepare(`SELECT p.species, p.location, p.created_at, p.id,
      CASE WHEN p.photo_data IS NOT NULL AND p.photo_data != '' THEN 1 ELSE 0 END as has_photo,
      CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name END as author_first,
      CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as author,
      CASE WHEN p.tenant_id IS NULL THEN '' ELSE 'Lot ' || COALESCE(t.lot_id, '') END as author_lot
      FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
      WHERE p.is_first_catch = 1 LIMIT 1`).get();
  }
  res.json({ total_posts: total, first_catch: firstCatch });
});

// ── Public: tenant badges ──
router.get('/badges/:tenantId', (req, res) => {
  var badges = db.prepare('SELECT badge_type, badge_label, earned_at FROM tenant_badges WHERE tenant_id=? ORDER BY earned_at').all(parseInt(req.params.tenantId));
  res.json(badges);
});

// ── Public: leaderboard ──
router.get('/leaderboard', (req, res) => {
  var month = new Date().toISOString().slice(0, 7);
  var biggestBass = db.prepare(`SELECT p.species, p.weight_lbs, p.weight_oz, p.length_inches, p.id,
    CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as author
    FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE p.post_type='fishing' AND p.created_at LIKE ? AND p.species LIKE '%Bass%'
    ORDER BY (p.weight_lbs + p.weight_oz/16.0) DESC LIMIT 1`).get(month + '%');
  var biggestCatch = db.prepare(`SELECT p.species, p.weight_lbs, p.weight_oz, p.id,
    CASE WHEN p.tenant_id IS NULL THEN 'Visitor' ELSE t.first_name || ' ' || t.last_name END as author
    FROM hunting_fishing_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE p.post_type='fishing' AND p.created_at LIKE ?
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
  var speciesCount = db.prepare(`SELECT COUNT(DISTINCT species) as c FROM hunting_fishing_posts WHERE post_type='fishing' AND created_at LIKE ?`).get(month + '%');
  res.json({ biggestBass, biggestCatch, mostCatches, mostActive, speciesCount: speciesCount?.c || 0 });
});

// ── Admin routes ──
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
  var cur = db.prepare('SELECT is_featured FROM hunting_fishing_posts WHERE id=?').get(parseInt(req.params.id));
  db.prepare('UPDATE hunting_fishing_posts SET is_featured=? WHERE id=?').run(cur?.is_featured ? 0 : 1, parseInt(req.params.id));
  res.json({ success: true });
});

router.put('/:id/biggest', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var cur = db.prepare('SELECT is_biggest_of_month FROM hunting_fishing_posts WHERE id=?').get(parseInt(req.params.id));
  db.prepare('UPDATE hunting_fishing_posts SET is_biggest_of_month=? WHERE id=?').run(cur?.is_biggest_of_month ? 0 : 1, parseInt(req.params.id));
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM catch_photos WHERE post_id=?').run(parseInt(req.params.id));
  db.prepare('DELETE FROM catch_reactions WHERE post_id=?').run(parseInt(req.params.id));
  db.prepare('DELETE FROM catch_comments WHERE post_id=?').run(parseInt(req.params.id));
  db.prepare('DELETE FROM hunting_fishing_posts WHERE id=?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// ── Admin: comment on a catch (as Park Management) ──
router.post('/:id/comments/admin', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var postId = parseInt(req.params.id);
  var { comment } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment is required' });
  if (comment.length > 500) return res.status(400).json({ error: 'Comment too long (max 500 chars)' });
  db.prepare('INSERT INTO catch_comments (post_id, tenant_id, author_name, comment, is_management) VALUES (?,NULL,?,?,1)')
    .run(postId, req.user.username || 'Park Management', comment.trim());
  res.json({ success: true });
});

// ── Admin: react to a catch (uses tenant_id = -1 as admin marker) ──
router.post('/:id/react/admin', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var postId = parseInt(req.params.id);
  var { reaction_type } = req.body || {};
  if (!REACTION_TYPES.includes(reaction_type)) return res.status(400).json({ error: 'Invalid reaction type' });
  var ADMIN_TENANT_ID = -1;
  var existing = db.prepare('SELECT id FROM catch_reactions WHERE post_id=? AND tenant_id=? AND reaction_type=?').get(postId, ADMIN_TENANT_ID, reaction_type);
  if (existing) {
    db.prepare('DELETE FROM catch_reactions WHERE id=?').run(existing.id);
    res.json({ toggled: 'removed' });
  } else {
    db.prepare('INSERT INTO catch_reactions (post_id, tenant_id, reaction_type) VALUES (?,?,?)').run(postId, ADMIN_TENANT_ID, reaction_type);
    res.json({ toggled: 'added' });
  }
});

// ── Admin: get admin's reactions ──
router.get('/admin-reactions', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var rows = db.prepare('SELECT post_id, reaction_type FROM catch_reactions WHERE tenant_id = -1').all();
  var map = {};
  rows.forEach(r => {
    if (!map[r.post_id]) map[r.post_id] = [];
    map[r.post_id].push(r.reaction_type);
  });
  res.json(map);
});

module.exports = router;
