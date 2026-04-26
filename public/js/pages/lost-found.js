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
    (p.has_photo ? '<img src="/api/lost-found/' + p.id + '/photo" style="width:100%;height:180px;object-fit:cover;display:block" onerror="this.style.display=\'none\'">' : '') +
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
