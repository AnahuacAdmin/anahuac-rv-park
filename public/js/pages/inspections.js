/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
let _inspectionsCache = [];

const _sevConfig = {
  record:   { icon: '📋', label: 'Record Only',       color: '#6b7280', bg: '#f3f4f6', desc: 'Save photo, no notification' },
  reminder: { icon: '💬', label: 'Friendly Reminder',  color: '#0284c7', bg: '#eff6ff', desc: 'Send gentle nudge to tenant' },
  warning:  { icon: '⚠️', label: 'Warning',            color: '#d97706', bg: '#fff7ed', desc: '3 days to clean up or $25 fine' },
  fine:     { icon: '💰', label: 'Fine Now ($25)',      color: '#dc2626', bg: '#fee2e2', desc: 'Add $25 fine immediately' },
};

async function loadInspections() {
  const [inspections, tenants] = await Promise.all([API.get('/inspections'), API.get('/tenants')]);
  _inspectionsCache = inspections || [];
  const drafts = _inspectionsCache.filter(i => i.status === 'draft');
  const sent = _inspectionsCache.filter(i => i.status === 'sent');
  const resolved = _inspectionsCache.filter(i => i.status === 'resolved');

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('inspections')}
    <div class="page-header">
      <h2>📸 Lot Inspections</h2>
      <button class="btn btn-primary" onclick="showNewInspection()">+ Log New Issue</button>
    </div>

    ${drafts.length ? `
    <div class="card" style="border-left:4px solid #f59e0b">
      <h3>📝 Drafts — Ready to Review & Send (${drafts.length})</h3>
      <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem">
        ${drafts.map(i => _inspectionCard(i, true)).join('')}
      </div>
    </div>` : ''}

    ${sent.length ? `
    <div class="card">
      <button class="collapse-toggle" onclick="var b=this.nextElementSibling;b.style.display=b.style.display==='none'?'':'none';this.querySelector('.caret').textContent=b.style.display==='none'?'▼':'▲'" style="width:100%;background:none;border:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:0;font:inherit">
        <h3 style="margin:0">📤 Sent Inspections (${sent.length})</h3>
        <span class="caret" style="color:#a8a29e">▼</span>
      </button>
      <div style="display:none;margin-top:0.5rem">
        ${sent.map(i => _inspectionCard(i, false)).join('')}
      </div>
    </div>` : ''}

    ${resolved.length ? `
    <div class="card">
      <button class="collapse-toggle" onclick="var b=this.nextElementSibling;b.style.display=b.style.display==='none'?'':'none';this.querySelector('.caret').textContent=b.style.display==='none'?'▼':'▲'" style="width:100%;background:none;border:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:0;font:inherit">
        <h3 style="margin:0">✅ Resolved (${resolved.length})</h3>
        <span class="caret" style="color:#a8a29e">▼</span>
      </button>
      <div style="display:none;margin-top:0.5rem">
        ${resolved.map(i => _inspectionCard(i, false)).join('')}
      </div>
    </div>` : ''}

    ${!_inspectionsCache.length ? `
    <div class="card" style="text-align:center;padding:2rem;color:#78716c">
      <p style="font-size:1.5rem;margin-bottom:0.5rem">📸</p>
      <p>No lot inspections yet. Tap <strong>Log New Issue</strong> to photograph and document a lot.</p>
    </div>` : ''}
  `;
}

function _inspectionCard(i, isDraft) {
  var sev = _sevConfig[i.severity] || _sevConfig.record;
  var photoThumb = i.photo ? '<img src="/api/inspections/' + i.id + '/photo" style="width:60px;height:60px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid #e5e7eb" onclick="showModal(\'Photo\',\'<img src=/api/inspections/' + i.id + '/photo style=max-width:100%;border-radius:8px>\')">' : '<div style="width:60px;height:60px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#a8a29e;font-size:1.2rem">📷</div>';
  var name = (i.first_name || '') + ' ' + (i.last_name || '');
  var date = i.created_at ? new Date(i.created_at).toLocaleDateString() : '';
  var sentDate = i.sent_at ? new Date(i.sent_at).toLocaleDateString() : '';
  var resolvedDate = i.resolved_at ? new Date(i.resolved_at).toLocaleDateString() : '';

  var buttons = '';
  if (isDraft) {
    buttons = '<div class="btn-group" style="margin-top:0.5rem">' +
      '<button class="btn btn-sm btn-primary" onclick="sendInspection(' + i.id + ')">📤 Send Now</button>' +
      '<button class="btn btn-sm btn-outline" onclick="editInspection(' + i.id + ')">✏️ Edit</button>' +
      '<button class="btn btn-sm btn-danger" onclick="deleteInspection(' + i.id + ')">🗑️</button>' +
    '</div>';
  } else if (i.status === 'sent') {
    buttons = '<button class="btn btn-sm btn-success" style="margin-top:0.5rem" onclick="resolveInspection(' + i.id + ')">✅ Mark Resolved</button>';
  }

  return '<div style="display:flex;gap:0.75rem;padding:0.6rem;background:#fafaf9;border-radius:10px;border:1px solid #e5e7eb">' +
    photoThumb +
    '<div style="flex:1;min-width:0">' +
      '<div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">' +
        '<strong style="font-size:0.88rem">' + escapeHtml(name) + '</strong>' +
        '<span style="font-size:0.75rem;color:#78716c">Lot ' + escapeHtml(i.lot_id || '?') + '</span>' +
        '<span style="font-size:0.68rem;font-weight:700;color:' + sev.color + ';background:' + sev.bg + ';padding:1px 6px;border-radius:6px">' + sev.icon + ' ' + sev.label + '</span>' +
      '</div>' +
      (i.notes ? '<div style="font-size:0.82rem;color:#44403c;margin-top:0.2rem;line-height:1.4">' + escapeHtml(i.notes).slice(0, 120) + (i.notes.length > 120 ? '...' : '') + '</div>' : '') +
      '<div style="font-size:0.7rem;color:#a8a29e;margin-top:0.2rem">' +
        'Logged ' + date +
        (sentDate ? ' · Sent ' + sentDate : '') +
        (resolvedDate ? ' · Resolved ' + resolvedDate : '') +
        (i.fine_amount > 0 ? ' · <span style="color:#dc2626;font-weight:700">$' + Number(i.fine_amount).toFixed(2) + ' fine</span>' : '') +
      '</div>' +
      buttons +
    '</div></div>';
}

async function showNewInspection() {
  var tenants = await API.get('/tenants');
  showModal('📸 Log New Issue', `
    <div class="form-group">
      <label>Guest / Lot</label>
      <select id="insp-tenant" style="font-size:1rem" required>
        <option value="">Select guest...</option>
        ${(tenants || []).filter(t => t.is_active).map(t => '<option value="' + t.id + '" data-lot="' + escapeHtml(t.lot_id || '') + '">' + escapeHtml(t.lot_id || '?') + ' — ' + escapeHtml(t.first_name + ' ' + t.last_name) + '</option>').join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Photo of Lot</label>
      <label id="insp-photo-label" style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.5rem;min-height:56px;border:2px dashed #1a5c32;border-radius:14px;background:#f0fdf4;color:#1a5c32;font-weight:700;font-size:0.92rem;transition:all 0.15s">
        <input type="file" accept="image/*" capture="environment" style="display:none" id="insp-photo-input"> 📷 TAP TO PHOTOGRAPH LOT
      </label>
      <span id="insp-photo-status" style="font-size:0.78rem;color:#78716c"></span>
      <div id="insp-photo-preview" style="margin-top:0.5rem"></div>
      <input type="hidden" id="insp-photo-data">
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="insp-notes" rows="3" placeholder="Describe the issue..." spellcheck="true" style="min-height:80px"></textarea>
    </div>
    <div class="form-group">
      <label>Severity</label>
      <div id="insp-severity-cards" style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem">
        ${Object.entries(_sevConfig).map(([key, s]) =>
          '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.6rem;border:1.5px solid ' + (key === 'record' ? '#1a5c32' : '#e0e0e0') + ';border-radius:10px;cursor:pointer;background:' + (key === 'record' ? s.bg : '#fff') + ';transition:all 0.15s" class="sev-card" data-sev="' + key + '">' +
          '<input type="radio" name="insp-severity" value="' + key + '"' + (key === 'record' ? ' checked' : '') + ' style="accent-color:#1a5c32">' +
          '<div><div style="font-weight:700;font-size:0.82rem;color:' + s.color + '">' + s.icon + ' ' + s.label + '</div>' +
          '<div style="font-size:0.68rem;color:#78716c">' + s.desc + '</div></div></label>'
        ).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" id="insp-save-btn" style="margin-top:0.5rem">💾 Save Draft</button>
  `);
  setTimeout(function() {
    // Photo compression
    var photoInput = document.getElementById('insp-photo-input');
    if (photoInput) photoInput.addEventListener('change', function() {
      var file = this.files && this.files[0];
      if (!file) return;
      document.getElementById('insp-photo-status').textContent = '📸 Processing...';
      var reader = new FileReader();
      reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
          var canvas = document.createElement('canvas');
          var scale = Math.min(1, 1200 / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          var sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
          document.getElementById('insp-photo-data').value = dataUrl.split(',')[1];
          document.getElementById('insp-photo-status').textContent = '✅ Photo ready (' + sizeKB + 'KB)';
          document.getElementById('insp-photo-preview').innerHTML = '<img src="' + dataUrl + '" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:2px solid #16a34a">';
          document.getElementById('insp-photo-label').innerHTML = '📷 Photo captured ✅';
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });

    // Severity card selection styling
    document.querySelectorAll('.sev-card').forEach(function(card) {
      card.querySelector('input').addEventListener('change', function() {
        document.querySelectorAll('.sev-card').forEach(function(c) {
          var s = _sevConfig[c.dataset.sev];
          var isSelected = c.querySelector('input').checked;
          c.style.borderColor = isSelected ? '#1a5c32' : '#e0e0e0';
          c.style.background = isSelected ? s.bg : '#fff';
        });
      });
    });

    // Save button
    document.getElementById('insp-save-btn').addEventListener('click', async function() {
      var sel = document.getElementById('insp-tenant');
      if (!sel.value) { alert('Please select a tenant.'); return; }
      var lotId = sel.selectedOptions[0]?.dataset?.lot || '';
      var severity = document.querySelector('input[name="insp-severity"]:checked')?.value || 'record';
      this.disabled = true; this.textContent = 'Saving...';
      try {
        await API.post('/inspections', {
          tenant_id: parseInt(sel.value),
          lot_id: lotId,
          photo: document.getElementById('insp-photo-data')?.value || null,
          notes: document.getElementById('insp-notes')?.value || '',
          severity: severity,
        });
        closeModal();
        showStatusToast('✅', 'Inspection saved as draft');
        loadInspections();
      } catch (err) { alert('Failed: ' + (err.message || 'unknown')); this.disabled = false; this.textContent = '💾 Save Draft'; }
    });
  }, 60);
}

async function sendInspection(id) {
  var insp = _inspectionsCache.find(function(i) { return i.id === id; });
  if (!insp) return;
  var sev = _sevConfig[insp.severity] || _sevConfig.record;
  var msg = 'Send this inspection?\n\nSeverity: ' + sev.label;
  if (insp.severity === 'fine') msg += '\n⚠️ This will add a $25 fine to the tenant\'s account.';
  if (insp.severity === 'record') msg += '\n(Record only — no notification will be sent)';
  if (!confirm(msg)) return;
  try {
    var r = await API.post('/inspections/' + id + '/send', {});
    var parts = [];
    if (r.messageSent) parts.push('notification sent');
    if (r.fineAdded) parts.push('$25 fine added');
    if (!parts.length) parts.push('recorded');
    showStatusToast('📤', 'Inspection ' + parts.join(', '));
    loadInspections();
  } catch (err) { alert('Send failed: ' + (err.message || 'unknown')); }
}

async function editInspection(id) {
  var insp = _inspectionsCache.find(function(i) { return i.id === id; });
  if (!insp) return;
  showModal('✏️ Edit Inspection', `
    <div class="form-group"><label>Notes</label><textarea id="edit-insp-notes" rows="3" spellcheck="true">${escapeHtml(insp.notes || '')}</textarea></div>
    <div class="form-group"><label>Severity</label>
      <select id="edit-insp-severity">
        ${Object.entries(_sevConfig).map(([key, s]) => '<option value="' + key + '"' + (key === insp.severity ? ' selected' : '') + '>' + s.icon + ' ' + s.label + '</option>').join('')}
      </select>
    </div>
    <button class="btn btn-primary btn-full" id="edit-insp-save">Save Changes</button>
  `);
  setTimeout(function() {
    document.getElementById('edit-insp-save').addEventListener('click', async function() {
      try {
        await API.put('/inspections/' + id, {
          notes: document.getElementById('edit-insp-notes').value,
          severity: document.getElementById('edit-insp-severity').value,
        });
        closeModal();
        showStatusToast('✅', 'Inspection updated');
        loadInspections();
      } catch (err) { alert('Failed: ' + (err.message || 'unknown')); }
    });
  }, 50);
}

async function deleteInspection(id) {
  if (!confirm('Delete this draft inspection?')) return;
  try {
    await API.del('/inspections/' + id);
    showStatusToast('🗑️', 'Inspection deleted');
    loadInspections();
  } catch (err) { alert('Delete failed: ' + (err.message || 'unknown')); }
}

async function resolveInspection(id) {
  if (!confirm('Mark this inspection as resolved?')) return;
  try {
    await API.post('/inspections/' + id + '/resolve', {});
    showStatusToast('✅', 'Inspection resolved');
    loadInspections();
  } catch (err) { alert('Failed: ' + (err.message || 'unknown')); }
}
