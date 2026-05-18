/*
 * Anahuac RV Park — Lost & Found Pets (Admin)
 */

async function loadLostFound() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }

  document.getElementById('page-content').innerHTML =
    '<div class="page-header"><h2>🐾 Lost & Found Pets</h2></div>' +
    '<div class="filter-bar">' +
      '<select id="lf-status-filter">' +
        '<option value="all">All Posts</option>' +
        '<option value="active" selected>Active</option>' +
        '<option value="reunited">Reunited</option>' +
        '<option value="archived">Archived</option>' +
      '</select>' +
      '<button class="btn btn-sm btn-outline" onclick="refreshLostFoundAdmin()">Filter</button>' +
    '</div>' +
    '<div id="lf-admin-list">Loading...</div>';

  refreshLostFoundAdmin();
}

async function refreshLostFoundAdmin() {
  var el = document.getElementById('lf-admin-list');
  if (!el) return;
  var status = document.getElementById('lf-status-filter')?.value || 'active';
  try {
    var posts = await API.get('/lost-found?status=' + status);
    if (!posts || !posts.length) {
      el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">🐾 No ' + status + ' posts found</div>';
      return;
    }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:0.75rem">' +
      posts.map(function(p) { return renderLFCardAdmin(p); }).join('') + '</div>';
  } catch { el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load</div>'; }
}

function renderLFCardAdmin(p) {
  var isLost = p.type === 'lost';
  var badgeColor = p.status === 'reunited' ? '#f59e0b' : isLost ? '#dc2626' : '#16a34a';
  var badgeBg = p.status === 'reunited' ? '#fffbeb' : isLost ? '#fef2f2' : '#f0fdf4';
  var badgeText = p.status === 'reunited' ? '🎉 REUNITED' : isLost ? '🔴 LOST' : '🟢 FOUND';
  var author = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Unknown';
  var ago = _lfTimeAgo(p.created_at);

  return '<div class="card" style="border-top:4px solid ' + badgeColor + ';padding:0">' +
    (p.has_photo ? '<img src="/api/lost-found/' + p.id + '/photo" style="width:100%;max-height:400px;height:auto;object-fit:contain;background:#1a1a1a;display:block" onerror="this.style.display=\'none\'">' : '') +
    '<div style="padding:0.75rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">' +
        '<span style="background:' + badgeBg + ';color:' + badgeColor + ';font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:6px">' + badgeText + '</span>' +
        '<span style="font-size:0.7rem;color:#a8a29e">' + ago + '</span>' +
      '</div>' +
      '<div style="font-weight:700;font-size:1rem;color:#1c1917;margin-bottom:0.25rem">' +
        escapeHtml((p.pet_name ? p.pet_name + ' — ' : '') + (p.pet_type || 'Pet')) + '</div>' +
      (p.breed ? '<div style="font-size:0.82rem;color:var(--gray-600)">' + escapeHtml(p.breed) + '</div>' : '') +
      (p.color_description ? '<div style="font-size:0.82rem;color:var(--gray-600)">' + escapeHtml(p.color_description) + '</div>' : '') +
      '<div style="font-size:0.82rem;color:var(--gray-500);margin-top:0.3rem">' +
        '📍 ' + escapeHtml(p.last_seen_location || 'Unknown location') +
        ' · ' + formatDate(p.date_occurred) +
      '</div>' +
      (p.contact_phone ? '<div style="font-size:0.82rem;margin-top:0.2rem">📞 ' + escapeHtml(p.contact_phone) + '</div>' : '') +
      '<div style="font-size:0.78rem;color:var(--gray-400);margin-top:0.25rem">Posted by ' + escapeHtml(author) + (p.lot_id ? ' · Lot ' + p.lot_id : '') + '</div>' +
      '<div id="lf-admin-comments-' + p.id + '" style="margin-top:0.5rem;display:none"></div>' +
      '<button class="btn btn-sm btn-outline" style="margin-top:0.4rem;font-size:0.75rem;width:100%" onclick="toggleLFAdminComments(' + p.id + ')">💬 Comments (' + (p.comment_count || 0) + ')</button>' +
      '<div class="btn-group" style="margin-top:0.5rem">' +
        (p.status === 'active' ? '<button class="btn btn-sm btn-success" onclick="adminLFStatus(' + p.id + ',\'reunited\')">🎉 Mark Reunited</button>' : '') +
        (p.status === 'active' ? '<button class="btn btn-sm btn-outline" onclick="adminLFStatus(' + p.id + ',\'archived\')">Archive</button>' : '') +
        (p.status === 'archived' ? '<button class="btn btn-sm btn-outline" onclick="adminLFStatus(' + p.id + ',\'active\')">Reactivate</button>' : '') +
        '<button class="btn btn-sm btn-danger" onclick="adminLFDelete(' + p.id + ')">Delete</button>' +
      '</div>' +
    '</div></div>';
}

function _lfTimeAgo(dt) {
  if (!dt) return '';
  try {
    var d = new Date(String(dt).replace(' ', 'T') + (dt.includes('T') ? '' : 'Z'));
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString();
  } catch { return dt; }
}

async function adminLFStatus(id, status) {
  await API.put('/lost-found/' + id + '/status', { status: status });
  showStatusToast('✅', 'Status updated');
  refreshLostFoundAdmin();
}

async function adminLFDelete(id) {
  if (!confirm('Delete this post permanently?')) return;
  await API.del('/lost-found/' + id);
  refreshLostFoundAdmin();
}

async function toggleLFAdminComments(postId) {
  var el = document.getElementById('lf-admin-comments-' + postId);
  if (!el) return;
  if (el.style.display === 'block') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<div style="font-size:0.8rem;color:#a8a29e;text-align:center;padding:0.3rem">Loading...</div>';
  try {
    var res = await fetch('/api/lost-found/' + postId + '/comments');
    var comments = await res.json();
    var html = '';
    if (comments.length) {
      html += comments.map(function(c) {
        var mgmt = c.is_management ? '<span style="background:#16a34a;color:#fff;font-size:0.6rem;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:4px">STAFF</span>' : '';
        return '<div style="margin-bottom:0.35rem;padding:0.35rem 0.5rem;background:' + (c.is_management ? '#f0fdf4' : '#f5f5f4') + ';border-radius:6px;' +
          (c.is_management ? 'border-left:3px solid #16a34a' : '') + '">' +
          '<div style="font-size:0.72rem"><strong>' + escapeHtml(c.author) + '</strong>' + mgmt +
          (c.author_lot ? ' <span style="color:#a8a29e">' + escapeHtml(c.author_lot) + '</span>' : '') +
          ' <span style="color:#a8a29e">· ' + _lfTimeAgo(c.created_at) + '</span></div>' +
          '<div style="font-size:0.78rem;color:#44403c;margin-top:0.1rem">' + escapeHtml(c.comment) + '</div></div>';
      }).join('');
    } else {
      html += '<div style="font-size:0.78rem;color:#a8a29e;text-align:center;padding:0.2rem">No comments yet</div>';
    }
    html += '<div style="display:flex;gap:0.35rem;margin-top:0.35rem">' +
      '<input id="lf-admin-comment-input-' + postId + '" placeholder="Comment as Park Management..." style="flex:1;font-size:0.78rem;padding:5px 8px;border:1px solid #d6d3d1;border-radius:6px">' +
      '<button onclick="submitLFAdminComment(' + postId + ')" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap">🛡️ Send</button>' +
    '</div>';
    el.innerHTML = html;
  } catch { el.innerHTML = '<div style="color:#dc2626;font-size:0.78rem">Could not load comments</div>'; }
}

async function submitLFAdminComment(postId) {
  var input = document.getElementById('lf-admin-comment-input-' + postId);
  if (!input || !input.value.trim()) return;
  var btn = input.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    await API.post('/lost-found/' + postId + '/comments/admin', { comment: input.value.trim() });
    toggleLFAdminComments(postId);
    toggleLFAdminComments(postId);
  } catch {
    if (typeof showStatusToast === 'function') showStatusToast('❌', 'Could not post comment'); else alert('Could not post comment');
    if (btn) { btn.disabled = false; btn.textContent = '🛡️ Send'; }
  }
}
