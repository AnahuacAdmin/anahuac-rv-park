/*
 * Anahuac RV Park — Hunting & Fishing Brag Board (Admin)
 */

var _hfAdminReactions = {};
var HF_REACTION_MAP = { fishing_pole: '🎣', heart: '❤️', fire: '🔥', clap: '👏' };

async function loadHuntingFishing() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  document.getElementById('page-content').innerHTML =
    '<div class="page-header"><h2>🎣 Hunting & Fishing Board</h2></div>' +
    '<div id="hf-admin-list">Loading...</div>';
  // Load admin reactions then render
  try {
    _hfAdminReactions = await API.get('/hunting-fishing/admin-reactions') || {};
  } catch { _hfAdminReactions = {}; }
  refreshHFAdmin();
}

async function refreshHFAdmin() {
  var el = document.getElementById('hf-admin-list');
  if (!el) return;
  try {
    var posts = await API.get('/hunting-fishing');
    if (!posts || !posts.length) { el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">🎣 No posts yet</div>'; return; }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:0.75rem">' +
      posts.map(function(p) {
        var author = p.first_name ? p.first_name + ' ' + p.last_name : 'Visitor';
        var lot = p.lot_id ? ' (Lot ' + p.lot_id + ')' : '';
        var isFishing = p.post_type === 'fishing';
        var weight = p.weight_lbs ? p.weight_lbs + ' lbs' + (p.weight_oz ? ' ' + p.weight_oz + ' oz' : '') : '';
        var length = p.length_inches ? p.length_inches + '"' : '';
        var measure = [weight, length].filter(Boolean).join(' · ');
        // Admin reaction buttons
        var myReactions = _hfAdminReactions[p.id] || [];
        var reactionBtns = Object.keys(HF_REACTION_MAP).map(function(key) {
          var active = myReactions.indexOf(key) >= 0;
          return '<button onclick="toggleHFAdminReact(' + p.id + ',\'' + key + '\')" title="' + key + '" style="' +
            'background:' + (active ? '#dcfce7' : '#f5f5f4') + ';border:1px solid ' + (active ? '#16a34a' : '#d6d3d1') + ';' +
            'border-radius:6px;padding:3px 8px;font-size:0.85rem;cursor:pointer;transition:all 0.15s">' +
            HF_REACTION_MAP[key] + '</button>';
        }).join('');

        return '<div class="card" style="padding:0;overflow:hidden;border-top:4px solid ' + (isFishing ? '#0284c7' : '#92400e') + '">' +
          (p.has_photo ? '<img src="/api/hunting-fishing/' + p.id + '/photo" style="width:100%;max-height:400px;height:auto;object-fit:contain;background:#1a1a1a" onerror="this.style.display=\'none\'">' : '') +
          '<div style="padding:0.75rem">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<strong>' + escapeHtml(p.species || '?') + '</strong>' +
              '<span style="font-size:0.68rem;font-weight:700;padding:2px 6px;border-radius:4px;background:' + (isFishing ? '#eff6ff' : '#fef3c7') + ';color:' + (isFishing ? '#0284c7' : '#92400e') + '">' + (isFishing ? '🎣 Fishing' : '🦆 Hunting') + '</span>' +
            '</div>' +
            (measure ? '<div style="font-size:0.82rem;color:var(--gray-600)">' + measure + '</div>' : '') +
            '<div style="font-size:0.75rem;color:var(--gray-400);margin-top:0.2rem">📍 ' + escapeHtml(p.location || '?') + ' · By ' + escapeHtml(author) + escapeHtml(lot) + '</div>' +
            (p.is_biggest_of_month ? '<div style="font-size:0.72rem;font-weight:700;color:#f59e0b;margin-top:0.2rem">🥇 BIGGEST CATCH OF THE MONTH</div>' : '') +
            // Admin reactions row
            '<div style="display:flex;gap:4px;margin-top:0.5rem;flex-wrap:wrap;align-items:center">' +
              '<span style="font-size:0.7rem;color:var(--gray-400);margin-right:2px">React:</span>' + reactionBtns +
            '</div>' +
            // Comments section
            '<div id="hf-admin-comments-' + p.id + '" style="margin-top:0.5rem"></div>' +
            '<button class="btn btn-sm btn-outline" style="margin-top:0.4rem;font-size:0.75rem;width:100%" onclick="toggleHFAdminComments(' + p.id + ')">💬 Comments</button>' +
            // Admin action buttons
            '<div class="btn-group" style="margin-top:0.5rem">' +
              '<button class="btn btn-sm btn-outline" onclick="toggleHFFeature(' + p.id + ')">' + (p.is_featured ? '⭐ Unfeature' : '⭐ Feature') + '</button>' +
              '<button class="btn btn-sm btn-outline" onclick="toggleHFBiggest(' + p.id + ')">' + (p.is_biggest_of_month ? '🥇 Remove Badge' : '🥇 Biggest') + '</button>' +
              '<button class="btn btn-sm btn-danger" onclick="deleteHFPost(' + p.id + ')">Delete</button>' +
            '</div>' +
          '</div></div>';
      }).join('') + '</div>';
  } catch { el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load</div>'; }
}

async function toggleHFAdminReact(postId, reactionType) {
  try {
    var result = await API.post('/hunting-fishing/' + postId + '/react/admin', { reaction_type: reactionType });
    // Update local state
    if (!_hfAdminReactions[postId]) _hfAdminReactions[postId] = [];
    if (result.toggled === 'added') {
      if (_hfAdminReactions[postId].indexOf(reactionType) < 0) _hfAdminReactions[postId].push(reactionType);
    } else {
      _hfAdminReactions[postId] = _hfAdminReactions[postId].filter(function(r) { return r !== reactionType; });
    }
    refreshHFAdmin();
  } catch { showStatusToast('❌', 'Could not react'); }
}

async function toggleHFAdminComments(postId) {
  var el = document.getElementById('hf-admin-comments-' + postId);
  if (!el) return;
  if (el.style.display === 'block') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<div style="font-size:0.8rem;color:#a8a29e;text-align:center;padding:0.3rem">Loading...</div>';
  try {
    var res = await fetch('/api/hunting-fishing/' + postId + '/comments', { headers: { 'Authorization': 'Bearer ' + API.token } });
    var comments = await res.json();
    var html = '';
    if (comments.length) {
      html += comments.map(function(c) {
        var mgmt = c.is_management ? '<span style="background:#16a34a;color:#fff;font-size:0.6rem;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:4px">STAFF</span>' : '';
        return '<div style="margin-bottom:0.35rem;padding:0.35rem 0.5rem;background:' + (c.is_management ? '#f0fdf4' : '#f5f5f4') + ';border-radius:6px;' +
          (c.is_management ? 'border-left:3px solid #16a34a' : '') + '">' +
          '<div style="font-size:0.72rem"><strong>' + escapeHtml(c.author) + '</strong>' + mgmt +
          (c.author_lot ? ' <span style="color:#a8a29e">' + escapeHtml(c.author_lot) + '</span>' : '') +
          ' <span style="color:#a8a29e">· ' + _hfTimeAgo(c.created_at) + '</span></div>' +
          '<div style="font-size:0.78rem;color:#44403c;margin-top:0.1rem">' + escapeHtml(c.comment) + '</div></div>';
      }).join('');
    } else {
      html += '<div style="font-size:0.78rem;color:#a8a29e;text-align:center;padding:0.2rem">No comments yet</div>';
    }
    // Admin comment input
    html += '<div style="display:flex;gap:0.35rem;margin-top:0.35rem">' +
      '<input id="hf-admin-comment-input-' + postId + '" placeholder="Comment as Park Management..." style="flex:1;font-size:0.78rem;padding:5px 8px;border:1px solid #d6d3d1;border-radius:6px">' +
      '<button onclick="submitHFAdminComment(' + postId + ')" style="background:#1a5c32;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap">🛡️ Send</button>' +
    '</div>';
    el.innerHTML = html;
  } catch { el.innerHTML = '<div style="color:#dc2626;font-size:0.78rem">Could not load comments</div>'; }
}

async function submitHFAdminComment(postId) {
  var input = document.getElementById('hf-admin-comment-input-' + postId);
  if (!input || !input.value.trim()) return;
  var btn = input.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    await API.post('/hunting-fishing/' + postId + '/comments/admin', { comment: input.value.trim() });
    toggleHFAdminComments(postId); // close
    toggleHFAdminComments(postId); // reopen to reload
  } catch {
    showStatusToast('❌', 'Could not post comment');
    if (btn) { btn.disabled = false; btn.textContent = '🛡️ Send'; }
  }
}

function _hfTimeAgo(dateStr) {
  if (!dateStr) return '';
  var diff = Date.now() - new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z')).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

async function toggleHFFeature(id) { await API.put('/hunting-fishing/' + id + '/feature', {}); refreshHFAdmin(); }
async function toggleHFBiggest(id) { await API.put('/hunting-fishing/' + id + '/biggest', {}); refreshHFAdmin(); }
async function deleteHFPost(id) { if (!confirm('Delete this post?')) return; await API.del('/hunting-fishing/' + id); refreshHFAdmin(); }
