/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */

var DOC_TYPES = [
  { value: 'lease', label: 'Lease Agreement', icon: '📋' },
  { value: 'rules', label: 'Signed Park Rules', icon: '📝' },
  { value: 'id', label: 'Photo ID', icon: '🪪' },
  { value: 'vehicle', label: 'Vehicle Registration', icon: '🚗' },
  { value: 'insurance', label: 'Insurance', icon: '🛡️' },
  { value: 'receipt', label: 'Receipt/Payment Proof', icon: '🧾' },
  { value: 'other', label: 'Other', icon: '📄' },
];

function docTypeLabel(type) {
  var d = DOC_TYPES.find(function(t) { return t.value === type; });
  return d ? d.icon + ' ' + d.label : '📄 ' + (type || 'Other');
}

function docTypeBadge(type) {
  var colors = { lease: 'info', rules: 'warning', id: 'success', vehicle: 'gray', insurance: 'info', receipt: 'success', other: 'gray' };
  return '<span class="badge badge-' + (colors[type] || 'gray') + '" style="font-size:0.65rem">' + docTypeLabel(type) + '</span>';
}

async function loadDocuments() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }

  var tenants = await API.get('/tenants');

  document.getElementById('page-content').innerHTML =
    helpPanel('documents') +
    '<div class="page-header"><h2>📄 Documents</h2>' +
    '<button class="btn btn-primary" id="btn-upload-doc">📤 Upload Document</button></div>' +

    '<div class="filter-bar">' +
      '<input type="text" id="doc-search" placeholder="Search by name, lot, or filename..." style="flex:1;max-width:300px">' +
      '<select id="doc-type-filter"><option value="all">All Types</option>' +
        DOC_TYPES.map(function(t) { return '<option value="' + t.value + '">' + t.icon + ' ' + t.label + '</option>'; }).join('') +
      '</select>' +
      '<select id="doc-tenant-filter"><option value="">All Tenants</option>' +
        (tenants || []).map(function(t) { return '<option value="' + t.id + '">' + t.lot_id + ' - ' + t.first_name + ' ' + t.last_name + '</option>'; }).join('') +
      '</select>' +
      '<button class="btn btn-sm btn-outline" id="btn-show-missing">⚠️ Missing Docs</button>' +
    '</div>' +

    '<div id="doc-list" style="margin-top:0.5rem">Loading...</div>';

  window._docTenants = tenants;

  // Wire events
  setTimeout(function() {
    var searchEl = document.getElementById('doc-search');
    var typeEl = document.getElementById('doc-type-filter');
    var tenantEl = document.getElementById('doc-tenant-filter');
    if (searchEl) searchEl.addEventListener('input', refreshDocList);
    if (typeEl) typeEl.addEventListener('change', refreshDocList);
    if (tenantEl) tenantEl.addEventListener('change', refreshDocList);
    var uploadBtn = document.getElementById('btn-upload-doc');
    if (uploadBtn) uploadBtn.addEventListener('click', showUploadDoc);
    var missingBtn = document.getElementById('btn-show-missing');
    if (missingBtn) missingBtn.addEventListener('click', showMissingDocs);
  }, 50);

  refreshDocList();
}

async function refreshDocList() {
  var el = document.getElementById('doc-list');
  if (!el) return;
  var search = (document.getElementById('doc-search') || {}).value || '';
  var docType = (document.getElementById('doc-type-filter') || {}).value || 'all';
  var tenantId = (document.getElementById('doc-tenant-filter') || {}).value || '';
  var url = '/documents?doc_type=' + encodeURIComponent(docType);
  if (search) url += '&search=' + encodeURIComponent(search);
  if (tenantId) url += '&tenant_id=' + encodeURIComponent(tenantId);

  try {
    var docs = await API.get(url);
    if (!docs || !docs.length) {
      el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c"><div style="font-size:2rem;margin-bottom:0.5rem">📄</div>No documents found.' + (search || tenantId ? ' Try different filters.' : ' Upload your first document above.') + '</div>';
      return;
    }
    el.innerHTML = '<div class="card"><div class="table-container"><table>' +
      '<thead><tr><th>Guest</th><th>Lot</th><th>Type</th><th>Document</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>' +
      docs.map(function(d) {
        return '<tr>' +
          '<td>' + escapeHtml((d.first_name || '') + ' ' + (d.last_name || '')) + '</td>' +
          '<td><strong>' + escapeHtml(d.lot_id || '—') + '</strong></td>' +
          '<td>' + docTypeBadge(d.doc_type) + '</td>' +
          '<td>' + escapeHtml(d.doc_name) + '</td>' +
          '<td style="font-size:0.78rem;color:#78716c">' + (d.uploaded_at || '—') + '</td>' +
          '<td class="btn-group">' +
            (d.has_file ? '<a href="/api/documents/' + d.id + '/download" target="_blank" class="btn btn-sm btn-outline">👁️ View</a>' : '') +
            '<button class="btn btn-sm btn-danger" onclick="deleteDocument(' + d.id + ',\'' + escapeHtml(d.doc_name).replace(/'/g, "\\'") + '\')">🗑️</button>' +
          '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>';
  } catch (err) {
    el.innerHTML = '<div class="card" style="padding:1rem;color:#dc2626">Failed to load documents: ' + (err.message || 'unknown') + '</div>';
  }
}

function showUploadDoc() {
  var tenants = window._docTenants || [];
  showModal('📤 Upload Document',
    '<form id="upload-doc-form">' +
    '<div class="form-group"><label>Guest</label><select name="tenant_id" id="upload-tenant-sel" required>' +
      '<option value="">Select guest...</option>' +
      tenants.map(function(t) { return '<option value="' + t.id + '" data-lot="' + (t.lot_id || '') + '">' + t.lot_id + ' - ' + t.first_name + ' ' + t.last_name + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Document Type</label><select name="doc_type">' +
      DOC_TYPES.map(function(t) { return '<option value="' + t.value + '">' + t.icon + ' ' + t.label + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Document Name</label><input name="doc_name" required placeholder="e.g. Lease Agreement - April 2026"></div>' +
    '<div class="form-group"><label>File (PDF, image, or scan)</label><input type="file" name="file" id="upload-doc-file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"></div>' +
    '<button type="submit" class="btn btn-primary btn-full">Upload</button>' +
    '</form>'
  );
  setTimeout(function() {
    var form = document.getElementById('upload-doc-form');
    if (form) form.addEventListener('submit', function(e) { submitUploadDoc(e); });
  }, 50);
}

async function submitUploadDoc(e) {
  e.preventDefault();
  var form = new FormData(e.target);
  var tenantId = form.get('tenant_id');
  var sel = document.getElementById('upload-tenant-sel');
  var lotId = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.lot : '';

  var fileInput = document.getElementById('upload-doc-file');
  var file = fileInput && fileInput.files[0];
  var fileData = null;
  var fileType = null;

  if (file) {
    fileType = file.type;
    fileData = await new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result.split(',')[1]); };
      reader.readAsDataURL(file);
    });
  }

  await API.post('/documents', {
    tenant_id: parseInt(tenantId),
    lot_id: lotId,
    doc_type: form.get('doc_type'),
    doc_name: form.get('doc_name'),
    file_data: fileData,
    file_type: fileType,
  });

  closeModal();
  showStatusToast('✅', 'Document uploaded');
  refreshDocList();
}

async function deleteDocument(id, name) {
  if (!confirm('Delete document "' + name + '"?')) return;
  await API.del('/documents/' + id);
  refreshDocList();
}

async function showMissingDocs() {
  try {
    var list = await API.get('/documents/missing');
    showModal('⚠️ Guests Missing Documents',
      list.length
        ? '<table><thead><tr><th>Lot</th><th>Guest</th><th>Documents</th></tr></thead><tbody>' +
          list.map(function(t) {
            return '<tr><td><strong>' + escapeHtml(t.lot_id) + '</strong></td><td>' + escapeHtml(t.first_name + ' ' + t.last_name) + '</td><td style="color:#dc2626;font-weight:600">0 documents</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p style="text-align:center;padding:1rem;color:#16a34a">All tenants have at least one document!</p>'
    );
  } catch (err) { alert('Failed: ' + (err.message || 'unknown')); }
}
