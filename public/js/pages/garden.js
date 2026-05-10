/*
 * Anahuac RV Park — Park Gardens Community (Admin)
 */

async function loadGarden() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  document.getElementById('page-content').innerHTML =
    '<div class="page-header"><h2>🌻 Park Gardens</h2></div>' +
    '<div id="garden-admin-list">Loading...</div>';
  refreshGardenAdmin();
}

async function refreshGardenAdmin() {
  var el = document.getElementById('garden-admin-list');
  if (!el) return;
  try {
    var posts = await API.get('/garden/public');
    if (!posts || !posts.length) {
      el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">🌱 No garden posts yet</div>';
      return;
    }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:0.75rem">' +
      posts.map(function(p) {
        var author = p.author || 'Visitor';
        var lot = p.author_lot ? ' (' + p.author_lot + ')' : '';
        var stage = p.stage || '';
        var totalPhotos = 1 + (p.extra_photo_count || 0);
        return '<div class="card" style="padding:0;overflow:hidden;border-top:4px solid #16a34a">' +
          (p.has_photo ? '<img src="/api/garden/' + p.id + '/photo" style="width:100%;max-height:400px;height:auto;object-fit:contain;background:#1a1a1a" onerror="this.style.display=\'none\'">' : '') +
          '<div style="padding:0.75rem">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<strong>' + escapeHtml(p.plant_name || 'A plant') + '</strong>' +
              (p.is_first_plant ? '<span style="font-size:0.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#dcfce7;color:#16a34a">🌻 FOUNDING</span>' : '') +
            '</div>' +
            (stage ? '<div style="font-size:0.78rem;color:var(--gray-600);margin-top:0.15rem">Stage: ' + escapeHtml(stage) + '</div>' : '') +
            (totalPhotos > 1 ? '<div style="font-size:0.72rem;color:var(--gray-500);margin-top:0.15rem">📷 ' + totalPhotos + ' photos</div>' : '') +
            (p.caption ? '<div style="font-size:0.82rem;color:#1c1917;margin-top:0.35rem;line-height:1.4">' + escapeHtml(p.caption) + '</div>' : '') +
            (p.growing_tips ? '<div style="font-size:0.78rem;color:#78716c;margin-top:0.3rem;padding:0.35rem 0.5rem;background:#fefce8;border-radius:6px"><strong>💡 Tips:</strong> ' + escapeHtml(p.growing_tips) + '</div>' : '') +
            '<div style="font-size:0.72rem;color:var(--gray-400);margin-top:0.35rem">By ' + escapeHtml(author) + escapeHtml(lot) + ' · ' + _gardenAdminTimeAgo(p.created_at) + '</div>' +
            '<div id="garden-admin-comments-' + p.id + '" style="margin-top:0.5rem;display:none"></div>' +
            '<button class="btn btn-sm btn-outline" style="margin-top:0.4rem;font-size:0.75rem;width:100%" onclick="toggleGardenAdminComments(' + p.id + ')">💬 Comments (' + (p.comment_count || 0) + ')</button>' +
            '<div class="btn-group" style="margin-top:0.5rem">' +
              '<button class="btn btn-sm btn-danger" onclick="deleteGardenPost(' + p.id + ')">Delete</button>' +
            '</div>' +
          '</div></div>';
      }).join('') + '</div>';
  } catch { el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load garden posts</div>'; }
}

async function toggleGardenAdminComments(postId) {
  var el = document.getElementById('garden-admin-comments-' + postId);
  if (!el) return;
  if (el.style.display === 'block') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<div style="font-size:0.8rem;color:#a8a29e;text-align:center;padding:0.3rem">Loading...</div>';
  try {
    var res = await fetch('/api/garden/' + postId + '/comments');
    var comments = await res.json();
    var html = '';
    if (comments.length) {
      html += comments.map(function(c) {
        var mgmt = c.is_management ? '<span style="background:#16a34a;color:#fff;font-size:0.6rem;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:4px">STAFF</span>' : '';
        return '<div style="margin-bottom:0.35rem;padding:0.35rem 0.5rem;background:' + (c.is_management ? '#f0fdf4' : '#f5f5f4') + ';border-radius:6px;' +
          (c.is_management ? 'border-left:3px solid #16a34a' : '') + '">' +
          '<div style="font-size:0.72rem"><strong>' + escapeHtml(c.author) + '</strong>' + mgmt +
          (c.author_lot ? ' <span style="color:#a8a29e">' + escapeHtml(c.author_lot) + '</span>' : '') +
          ' <span style="color:#a8a29e">· ' + _gardenAdminTimeAgo(c.created_at) + '</span></div>' +
          '<div style="font-size:0.78rem;color:#44403c;margin-top:0.1rem">' + escapeHtml(c.comment) + '</div></div>';
      }).join('');
    } else {
      html += '<div style="font-size:0.78rem;color:#a8a29e;text-align:center;padding:0.2rem">No comments yet</div>';
    }
    html += '<div style="display:flex;gap:0.35rem;margin-top:0.35rem">' +
      '<input id="garden-admin-comment-input-' + postId + '" placeholder="Comment as Park Management..." style="flex:1;font-size:0.78rem;padding:5px 8px;border:1px solid #d6d3d1;border-radius:6px">' +
      '<button onclick="submitGardenAdminComment(' + postId + ')" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap">🛡️ Send</button>' +
    '</div>';
    el.innerHTML = html;
  } catch { el.innerHTML = '<div style="color:#dc2626;font-size:0.78rem">Could not load comments</div>'; }
}

async function submitGardenAdminComment(postId) {
  var input = document.getElementById('garden-admin-comment-input-' + postId);
  if (!input || !input.value.trim()) return;
  var btn = input.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    await API.post('/garden/' + postId + '/comments', { comment: input.value.trim(), is_management: 1 });
    toggleGardenAdminComments(postId);
    toggleGardenAdminComments(postId);
  } catch {
    showStatusToast('❌', 'Could not post comment');
    if (btn) { btn.disabled = false; btn.textContent = '🛡️ Send'; }
  }
}

async function deleteGardenPost(id) {
  if (!confirm('Delete this garden post? This cannot be undone.')) return;
  try {
    await API.del('/garden/' + id);
    refreshGardenAdmin();
  } catch {
    showStatusToast('❌', 'Could not delete');
  }
}

function _gardenAdminTimeAgo(dateStr) {
  if (!dateStr) return '';
  var diff = Date.now() - new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z')).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}
