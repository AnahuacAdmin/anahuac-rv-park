/*
 * Anahuac RV Park — Hunting & Fishing Brag Board (Admin)
 */

async function loadHuntingFishing() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  document.getElementById('page-content').innerHTML =
    '<div class="page-header"><h2>🎣 Hunting & Fishing Board</h2></div>' +
    '<div id="hf-admin-list">Loading...</div>';
  refreshHFAdmin();
}

async function refreshHFAdmin() {
  var el = document.getElementById('hf-admin-list');
  if (!el) return;
  try {
    var posts = await API.get('/hunting-fishing');
    if (!posts || !posts.length) { el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">🎣 No posts yet</div>'; return; }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0.75rem">' +
      posts.map(function(p) {
        var author = p.first_name ? p.first_name + ' ' + p.last_name : 'Visitor';
        var isFishing = p.post_type === 'fishing';
        var weight = p.weight_lbs ? p.weight_lbs + ' lbs' + (p.weight_oz ? ' ' + p.weight_oz + ' oz' : '') : '';
        var length = p.length_inches ? p.length_inches + '"' : '';
        var measure = [weight, length].filter(Boolean).join(' · ');
        return '<div class="card" style="padding:0;overflow:hidden;border-top:4px solid ' + (isFishing ? '#0284c7' : '#92400e') + '">' +
          (p.has_photo ? '<img src="/api/hunting-fishing/' + p.id + '/photo" style="width:100%;height:160px;object-fit:cover" onerror="this.style.display=\'none\'">' : '') +
          '<div style="padding:0.75rem">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<strong>' + escapeHtml(p.species || '?') + '</strong>' +
              '<span style="font-size:0.68rem;font-weight:700;padding:2px 6px;border-radius:4px;background:' + (isFishing ? '#eff6ff' : '#fef3c7') + ';color:' + (isFishing ? '#0284c7' : '#92400e') + '">' + (isFishing ? '🎣 Fishing' : '🦆 Hunting') + '</span>' +
            '</div>' +
            (measure ? '<div style="font-size:0.82rem;color:var(--gray-600)">' + measure + '</div>' : '') +
            '<div style="font-size:0.75rem;color:var(--gray-400);margin-top:0.2rem">📍 ' + escapeHtml(p.location || '?') + ' · By ' + escapeHtml(author) + ' · ❤️ ' + (p.likes_count || 0) + '</div>' +
            (p.is_biggest_of_month ? '<div style="font-size:0.72rem;font-weight:700;color:#f59e0b;margin-top:0.2rem">🥇 BIGGEST CATCH OF THE MONTH</div>' : '') +
            '<div class="btn-group" style="margin-top:0.5rem">' +
              '<button class="btn btn-sm btn-outline" onclick="toggleHFFeature(' + p.id + ')">' + (p.is_featured ? '⭐ Unfeature' : '⭐ Feature') + '</button>' +
              '<button class="btn btn-sm btn-outline" onclick="toggleHFBiggest(' + p.id + ')">' + (p.is_biggest_of_month ? '🥇 Remove Badge' : '🥇 Biggest') + '</button>' +
              '<button class="btn btn-sm btn-danger" onclick="deleteHFPost(' + p.id + ')">Delete</button>' +
            '</div>' +
          '</div></div>';
      }).join('') + '</div>';
  } catch { el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load</div>'; }
}

async function toggleHFFeature(id) { await API.put('/hunting-fishing/' + id + '/feature', {}); refreshHFAdmin(); }
async function toggleHFBiggest(id) { await API.put('/hunting-fishing/' + id + '/biggest', {}); refreshHFAdmin(); }
async function deleteHFPost(id) { if (!confirm('Delete this post?')) return; await API.del('/hunting-fishing/' + id); refreshHFAdmin(); }
