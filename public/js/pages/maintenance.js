/*
 * Anahuac RV Park — Maintenance Requests
 */
var MAINT_CATS = ['Electrical','Plumbing','Water','Sewer','Pest','Parking','HVAC','Other'];
var MAINT_STATUS = { submitted:'🟡 Submitted', acknowledged:'🔵 Acknowledged', in_progress:'🟠 In Progress', resolved:'✅ Resolved' };

async function loadMaintenance() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  var reqs = await API.get('/maintenance');
  var open = (reqs || []).filter(function(r) { return r.status !== 'resolved'; }).length;

  document.getElementById('page-content').innerHTML =
    helpPanel('maintenance') +
    '<div class="page-header"><h2>🔧 Maintenance Requests</h2>' +
    '<span class="badge badge-' + (open > 0 ? 'warning' : 'success') + '">' + open + ' open</span></div>' +
    '<div id="maint-list"></div>';

  renderMaintList(reqs);
}

function renderMaintList(reqs) {
  var el = document.getElementById('maint-list');
  if (!el) return;
  if (!reqs || !reqs.length) {
    el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">🔧 No maintenance requests</div>';
    return;
  }
  el.innerHTML = reqs.map(function(r) {
    var statusBadge = MAINT_STATUS[r.status] || r.status;
    return '<div class="card" style="border-left:4px solid ' + (r.status === 'resolved' ? '#16a34a' : r.status === 'in_progress' ? '#f59e0b' : '#dc2626') + ';margin-bottom:0.5rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem">' +
        '<div><strong>' + escapeHtml((r.first_name || '') + ' ' + (r.last_name || '')) + '</strong> — Lot ' + escapeHtml(r.lot_id || '?') +
        '<br><span class="badge badge-info" style="font-size:0.65rem">' + escapeHtml(r.category) + '</span> ' + statusBadge + '</div>' +
        '<div style="font-size:0.75rem;color:#78716c">' + (r.created_at || '') + '</div>' +
      '</div>' +
      '<p style="margin:0.5rem 0;font-size:0.88rem">' + escapeHtml(r.description || '') + '</p>' +
      (r.resolution_notes ? '<p style="margin:0.25rem 0;font-size:0.82rem;color:#16a34a;border-left:2px solid #16a34a;padding-left:0.5rem"><strong>Resolution:</strong> ' + escapeHtml(r.resolution_notes) + '</p>' : '') +
      (r.photo ? '<img src="/api/maintenance/' + r.id + '/photo" style="max-width:120px;border-radius:6px;margin:0.5rem 0" onerror="this.style.display=\'none\'">' : '') +
      '<div class="btn-group" style="margin-top:0.5rem">' +
        (r.status !== 'resolved' ? '<button class="btn btn-sm btn-outline" onclick="updateMaintStatus(' + r.id + ',\'acknowledged\')">Acknowledge</button>' +
          '<button class="btn btn-sm btn-warning" onclick="updateMaintStatus(' + r.id + ',\'in_progress\')">In Progress</button>' +
          '<button class="btn btn-sm btn-success" onclick="showResolveMaint(' + r.id + ')">Resolve</button>' : '') +
        '<button class="btn btn-sm btn-danger" onclick="deleteMaint(' + r.id + ')">Delete</button>' +
      '</div></div>';
  }).join('');
}

async function updateMaintStatus(id, status) {
  await API.put('/maintenance/' + id, { status: status });
  loadMaintenance();
}

function showResolveMaint(id) {
  showModal('✅ Resolve Request', '<div class="form-group"><label>Resolution Notes</label><textarea id="resolve-notes" placeholder="What was done to fix the issue..."></textarea></div>' +
    '<button class="btn btn-success btn-full" id="btn-resolve-maint">Mark Resolved</button>');
  setTimeout(function() {
    var btn = document.getElementById('btn-resolve-maint');
    if (btn) btn.addEventListener('click', async function() {
      var notes = document.getElementById('resolve-notes')?.value || '';
      await API.put('/maintenance/' + id, { status: 'resolved', resolution_notes: notes });
      closeModal();
      showStatusToast('✅', 'Request resolved');
      loadMaintenance();
    });
  }, 50);
}

async function deleteMaint(id) {
  if (!confirm('Delete this maintenance request?')) return;
  await API.del('/maintenance/' + id);
  loadMaintenance();
}
