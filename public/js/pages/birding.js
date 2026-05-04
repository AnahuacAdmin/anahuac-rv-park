/*
 * Anahuac RV Park — Bird Sightings (Admin)
 */

async function loadBirding() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  document.getElementById('page-content').innerHTML =
    '<div class="page-header"><h2>🐦 Bird Sightings</h2><div class="btn-group">' +
      '<button class="btn btn-outline" onclick="exportBirdCSV()">📥 Export CSV</button>' +
    '</div></div>' +
    '<div id="birding-admin-list">Loading...</div>';
  refreshBirdingAdmin();
}

async function refreshBirdingAdmin() {
  var el = document.getElementById('birding-admin-list');
  if (!el) return;
  try {
    var posts = await API.get('/birding');
    if (!posts || !posts.length) { el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">🐦 No sightings yet</div>'; return; }

    // Stats
    var rareSightings = posts.filter(function(p) { return p.rarity === 'Rare' || p.rarity === 'Very Rare'; }).length;
    var topBirders = {};
    posts.forEach(function(p) {
      var name = p.first_name ? p.first_name + ' ' + p.last_name : 'Visitor';
      topBirders[name] = (topBirders[name] || 0) + 1;
    });
    var topList = Object.entries(topBirders).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5);

    el.innerHTML =
      '<div style="display:flex;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap">' +
        '<div class="card" style="flex:1;min-width:150px;text-align:center"><div style="font-size:1.5rem;font-weight:800">' + posts.length + '</div><div style="font-size:0.78rem;color:var(--gray-500)">Total Sightings</div></div>' +
        '<div class="card" style="flex:1;min-width:150px;text-align:center"><div style="font-size:1.5rem;font-weight:800;color:#f59e0b">' + rareSightings + '</div><div style="font-size:0.78rem;color:var(--gray-500)">Rare Sightings</div></div>' +
        '<div class="card" style="flex:2;min-width:200px"><div style="font-size:0.78rem;font-weight:600;color:var(--gray-600);margin-bottom:0.25rem">🏆 Top Birders</div>' +
          topList.map(function(e, i) { return '<div style="font-size:0.82rem">' + (i + 1) + '. ' + escapeHtml(e[0]) + ' <strong>(' + e[1] + ')</strong></div>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0.75rem">' +
        posts.map(function(p) {
          var author = p.first_name ? p.first_name + ' ' + p.last_name : 'Visitor';
          var rarityColor = p.rarity === 'Very Rare' ? '#dc2626' : p.rarity === 'Rare' ? '#f59e0b' : p.rarity === 'Uncommon' ? '#3b82f6' : '#16a34a';
          return '<div class="card" style="padding:0;overflow:hidden">' +
            (p.has_photo ? '<img src="/api/birding/' + p.id + '/photo" style="width:100%;max-height:400px;height:auto;object-fit:contain;background:#1a1a1a" onerror="this.style.display=\'none\'">' : '') +
            '<div style="padding:0.75rem">' +
              '<div style="display:flex;justify-content:space-between;align-items:center">' +
                '<strong style="font-size:1rem">' + escapeHtml(p.bird_name) + '</strong>' +
                '<span style="font-size:0.68rem;font-weight:700;color:' + rarityColor + ';background:' + rarityColor + '15;padding:2px 6px;border-radius:4px">' +
                  (p.rarity === 'Very Rare' || p.rarity === 'Rare' ? '🌟 ' : '') + p.rarity + '</span>' +
              '</div>' +
              '<div style="font-size:0.78rem;color:var(--gray-500);margin-top:0.2rem">📍 ' + escapeHtml(p.location || '?') + ' · ' + (p.spotted_date || '') + '</div>' +
              '<div style="font-size:0.78rem;color:var(--gray-400)">By ' + escapeHtml(author) + (p.lot_id ? ' · Lot ' + p.lot_id : '') + ' · ❤️ ' + (p.likes_count || 0) + '</div>' +
              '<div class="btn-group" style="margin-top:0.5rem">' +
                '<button class="btn btn-sm btn-outline" onclick="toggleFeatureBird(' + p.id + ')">' + (p.is_featured ? '⭐ Unfeature' : '⭐ Feature') + '</button>' +
                '<button class="btn btn-sm btn-danger" onclick="deleteBirdSighting(' + p.id + ')">Delete</button>' +
              '</div>' +
            '</div></div>';
        }).join('') + '</div>';
  } catch { el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load</div>'; }
}

async function toggleFeatureBird(id) { await API.put('/birding/' + id + '/feature', {}); refreshBirdingAdmin(); }
async function deleteBirdSighting(id) { if (!confirm('Delete this sighting?')) return; await API.del('/birding/' + id); refreshBirdingAdmin(); }
async function exportBirdCSV() {
  try {
    var res = await fetch('/api/birding/export/csv', { headers: { 'Authorization': 'Bearer ' + API.token } });
    var blob = await res.blob(); var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'bird-sightings.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch { alert('Export failed'); }
}
