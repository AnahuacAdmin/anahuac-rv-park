/*
 * Anahuac RV Park — Community Board Admin
 */
var POST_TYPES = { recognition: '🏆 Recognition', fishing: '🎣 Fishing', community: '📢 Community', event: '🎪 Event', announcement: '📋 Announcement' };

async function loadCommunity() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  var posts = await API.get('/community');
  var pending = (posts || []).filter(function(p) { return p.status === 'pending'; }).length;

  document.getElementById('page-content').innerHTML =
    helpPanel('community') +
    '<div class="page-header"><h2>📋 Community Board</h2><div class="btn-group">' +
    '<button class="btn btn-primary" id="btn-new-post">+ Create Post</button>' +
    '<button class="btn btn-warning" id="btn-recognition">🏆 Recognize Tenant</button>' +
    '</div></div>' +
    (pending > 0 ? '<div class="card" style="border-left:4px solid #f59e0b;margin-bottom:1rem;padding:0.6rem 1rem"><strong style="color:#d97706">⏳ ' + pending + ' post' + (pending > 1 ? 's' : '') + ' pending approval</strong></div>' : '') +
    '<div class="filter-bar"><select id="community-filter"><option value="all">All Posts</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>' +
    '<div id="community-list"></div>';

  window._communityPosts = posts;
  renderCommunityList(posts);

  setTimeout(function() {
    var newBtn = document.getElementById('btn-new-post');
    if (newBtn) newBtn.addEventListener('click', showCreatePost);
    var recBtn = document.getElementById('btn-recognition');
    if (recBtn) recBtn.addEventListener('click', showRecognizeTenant);
    var filter = document.getElementById('community-filter');
    if (filter) filter.addEventListener('change', function() {
      var v = this.value;
      var filtered = v === 'all' ? window._communityPosts : (window._communityPosts || []).filter(function(p) { return p.status === v; });
      renderCommunityList(filtered);
    });
  }, 50);
}

function renderCommunityList(posts) {
  var el = document.getElementById('community-list');
  if (!el) return;
  if (!posts || !posts.length) { el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">📋 No posts yet</div>'; return; }
  el.innerHTML = posts.map(function(p) {
    var statusColor = p.status === 'approved' ? '#16a34a' : p.status === 'pending' ? '#f59e0b' : '#dc2626';
    var author = p.first_name ? p.first_name + ' ' + p.last_name + ' — Lot ' + (p.lot_id || '?') : 'Park Management';
    var rc = p.reply_count || 0;
    return '<div class="card" style="border-left:4px solid ' + statusColor + ';margin-bottom:0.5rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem">' +
        '<div><span class="badge badge-info" style="font-size:0.65rem">' + (POST_TYPES[p.post_type] || p.post_type) + '</span> ' +
        '<span class="badge badge-' + (p.status === 'approved' ? 'success' : p.status === 'pending' ? 'warning' : 'danger') + '" style="font-size:0.65rem">' + p.status + '</span>' +
        (p.is_pinned ? ' <span style="font-size:0.7rem">📌</span>' : '') +
        '<br><strong>' + escapeHtml(p.title || '') + '</strong>' +
        '<br><span style="font-size:0.82rem;color:#78716c">' + escapeHtml(author) + '</span></div>' +
        '<span style="font-size:0.72rem;color:#a8a29e">' + (p.submitted_at || '') + '</span></div>' +
      '<p style="margin:0.5rem 0;font-size:0.88rem">' + escapeHtml(p.message || '') + '</p>' +
      (p.rejection_reason ? '<p style="font-size:0.78rem;color:#dc2626;border-left:2px solid #dc2626;padding-left:0.5rem">Rejected: ' + escapeHtml(p.rejection_reason) + '</p>' : '') +
      '<div style="display:flex;align-items:center;gap:1rem;font-size:0.78rem;color:#78716c">' +
        '<span>❤️ ' + (p.likes_count || 0) + ' likes</span>' +
        '<button style="background:none;border:none;color:#78716c;cursor:pointer;font-size:0.78rem;padding:0" onclick="toggleReplies(' + p.id + ')">' +
          '💬 ' + rc + ' comment' + (rc === 1 ? '' : 's') +
        '</button>' +
      '</div>' +
      '<div class="btn-group" style="margin-top:0.5rem">' +
        (p.status === 'pending' ? '<button class="btn btn-sm btn-success" onclick="approvePost(' + p.id + ')">✅ Approve</button><button class="btn btn-sm btn-danger" onclick="rejectPost(' + p.id + ')">❌ Reject</button>' : '') +
        '<button class="btn btn-sm btn-outline" onclick="toggleReplies(' + p.id + ')">💬 Reply</button>' +
        '<button class="btn btn-sm btn-outline" onclick="pinPost(' + p.id + ')">' + (p.is_pinned ? 'Unpin' : '📌 Pin') + '</button>' +
        '<button class="btn btn-sm btn-danger" onclick="deletePost(' + p.id + ')">Del</button></div>' +
      // Reply section — hidden by default, toggled by Reply button
      '<div id="replies-' + p.id + '" style="display:none;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #e5e7eb">' +
        '<div id="replies-list-' + p.id + '" style="margin-bottom:0.5rem"></div>' +
        '<div style="display:flex;gap:0.5rem;align-items:flex-start">' +
          '<textarea id="reply-input-' + p.id + '" rows="2" placeholder="Reply as Management..." style="flex:1;font-size:0.82rem;padding:0.4rem 0.6rem;border:1px solid #d6d3d1;border-radius:6px;resize:vertical;font-family:inherit"></textarea>' +
          '<button class="btn btn-sm btn-primary" onclick="submitAdminReply(' + p.id + ')">Send</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function toggleReplies(postId) {
  var section = document.getElementById('replies-' + postId);
  if (!section) return;
  if (section.style.display === 'none') {
    section.style.display = '';
    loadReplies(postId);
  } else {
    section.style.display = 'none';
  }
}

async function loadReplies(postId) {
  var el = document.getElementById('replies-list-' + postId);
  if (!el) return;
  el.innerHTML = '<span style="font-size:0.78rem;color:#a8a29e">Loading...</span>';
  try {
    var replies = await API.get('/community/' + postId + '/replies');
    if (!replies || !replies.length) {
      el.innerHTML = '<p style="font-size:0.78rem;color:#a8a29e;margin:0">No comments yet. Be the first to reply!</p>';
      return;
    }
    el.innerHTML = replies.map(function(r) {
      var mgmtBadge = r.is_management ? ' <span style="background:var(--brand-primary,#1a5c32);color:#fff;font-size:0.6rem;padding:1px 5px;border-radius:4px;font-weight:700;vertical-align:middle">Management</span>' : '';
      var lotTag = r.author_lot ? ' <span style="color:#a8a29e;font-size:0.72rem">· ' + escapeHtml(r.author_lot) + '</span>' : '';
      return '<div style="padding:0.4rem 0;border-bottom:1px solid #f5f5f4;font-size:0.82rem">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div><strong style="color:#1c1917">' + escapeHtml(r.author_name) + '</strong>' + mgmtBadge + lotTag + '</div>' +
          '<div style="display:flex;align-items:center;gap:0.4rem">' +
            '<span style="font-size:0.68rem;color:#a8a29e">' + formatReplyTime(r.created_at) + '</span>' +
            '<button style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:0.68rem;padding:0" onclick="deleteReply(' + r.id + ',' + r.post_id + ')" title="Delete reply">✕</button>' +
          '</div>' +
        '</div>' +
        '<div style="color:#44403c;margin-top:0.15rem;line-height:1.4">' + escapeHtml(r.message) + '</div>' +
      '</div>';
    }).join('');
  } catch {
    el.innerHTML = '<p style="font-size:0.78rem;color:#dc2626">Failed to load replies</p>';
  }
}

function formatReplyTime(dt) {
  if (!dt) return '';
  try {
    // SQLite CURRENT_TIMESTAMP gives "2026-04-16 20:30:00" — replace the
    // space with 'T' and append 'Z' so the browser parses it as UTC.
    var iso = String(dt).replace(' ', 'T');
    if (!iso.endsWith('Z') && !iso.includes('+')) iso += 'Z';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return dt;
    var now = new Date();
    var diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  } catch { return dt; }
}

async function submitAdminReply(postId) {
  var input = document.getElementById('reply-input-' + postId);
  if (!input) return;
  var msg = input.value.trim();
  if (!msg) return;
  try {
    await API.post('/community/' + postId + '/replies/admin', { message: msg });
    input.value = '';
    loadReplies(postId);
    // Update the comment count in the post card
    var countBtn = document.querySelector('#replies-' + postId).parentElement.querySelector('[onclick*="toggleReplies"]');
    if (countBtn) {
      var cur = parseInt(countBtn.textContent.match(/\d+/)?.[0] || '0') + 1;
      countBtn.textContent = '💬 ' + cur + ' comment' + (cur === 1 ? '' : 's');
    }
  } catch (err) {
    alert('Failed to post reply: ' + (err.message || 'unknown'));
  }
}

async function deleteReply(replyId, postId) {
  if (!confirm('Delete this reply?')) return;
  try {
    await API.del('/community/replies/' + replyId);
    loadReplies(postId);
  } catch (err) { alert('Failed: ' + (err.message || 'unknown')); }
}

async function approvePost(id) { await API.put('/community/' + id + '/approve', {}); loadCommunity(); }
async function rejectPost(id) {
  var reason = prompt('Rejection reason:');
  if (reason === null) return;
  await API.put('/community/' + id + '/reject', { reason: reason });
  loadCommunity();
}
async function pinPost(id) { await API.put('/community/' + id + '/pin', {}); loadCommunity(); }
async function deletePost(id) { if (!confirm('Delete this post?')) return; await API.del('/community/' + id); loadCommunity(); }

function showCreatePost() {
  showModal('+ Create Post', '<form id="create-post-form">' +
    '<div class="form-group"><label>Post Type</label><select name="post_type"><option value="announcement">📋 Announcement</option><option value="community">📢 Community</option><option value="event">🎪 Event</option></select></div>' +
    '<div class="form-group"><label>Title</label><input name="title" required></div>' +
    '<div class="form-group"><label>Message</label><textarea name="message" rows="4"></textarea></div>' +
    '<button type="submit" class="btn btn-primary btn-full">Post (auto-approved)</button></form>');
  setTimeout(function() {
    var form = document.getElementById('create-post-form');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var data = Object.fromEntries(new FormData(e.target));
      await API.post('/community', data);
      closeModal();
      showStatusToast('✅', 'Post published');
      loadCommunity();
    });
  }, 50);
}

async function showRecognizeTenant() {
  var tenants = await API.get('/tenants');
  showModal('🏆 Recognize a Tenant', '<form id="recognize-form">' +
    '<div class="form-group"><label>Tenant</label><select name="tenant_id" id="recognize-tenant" required><option value="">Select...</option>' +
    (tenants || []).map(function(t) { return '<option value="' + t.id + '" data-lot="' + t.lot_id + '">' + t.lot_id + ' - ' + t.first_name + ' ' + t.last_name + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Recognition Message</label><textarea name="message" rows="3" placeholder="What are you recognizing them for?"></textarea></div>' +
    '<button type="submit" class="btn btn-success btn-full">🏆 Post Recognition & Notify Tenant</button></form>');
  setTimeout(function() {
    var form = document.getElementById('recognize-form');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var sel = document.getElementById('recognize-tenant');
      var tenant = sel.selectedOptions[0];
      await API.post('/community', {
        tenant_id: parseInt(fd.get('tenant_id')),
        lot_id: tenant?.dataset.lot || '',
        post_type: 'recognition',
        title: '🏆 Shoutout to ' + (tenant?.textContent.split(' - ')[1] || '') + '!',
        message: fd.get('message'),
      });
      closeModal();
      showStatusToast('🏆', 'Recognition posted & tenant notified');
      loadCommunity();
    });
  }, 50);
}
