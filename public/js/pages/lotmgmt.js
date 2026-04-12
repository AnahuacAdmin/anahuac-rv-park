/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */

async function loadLotMgmt() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  const [lots, settings] = await Promise.all([API.get('/lots'), API.get('/settings')]);
  if (!lots) return;

  const defaultStandard = settings?.default_rate_standard || '295';
  const defaultPremium = settings?.default_rate_premium || '350';
  const defaultPullThrough = settings?.default_rate_pullthrough || '325';

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('lotmgmt')}
    <div class="page-header">
      <h2>Lot Management</h2>
      <button class="btn btn-primary" onclick="showAddLot()">+ Add New Lot</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>Lot ID</th><th>Row</th><th>#</th><th>Type</th><th>Size</th><th>Amenities</th><th>Default Rate</th><th>Status</th><th>Tenant</th><th>Actions</th></tr></thead>
          <tbody>
            ${lots.map(l => {
              const typeColor = { standard:'#2563eb', premium:'#7c3aed', 'pull-through':'#f59e0b', owner_reserved:'#9ca3af' }[l.lot_type || 'standard'] || '#2563eb';
              const amenities = (l.amenities || '').split(',').filter(Boolean).map(a => '<span class="badge badge-gray" style="font-size:0.6rem">' + escapeHtml(a.trim()) + '</span>').join(' ');
              const statusBadge = l.status === 'occupied' ? 'info' : l.status === 'vacant' ? 'success' : l.status === 'maintenance' ? 'danger' : 'gray';
              let actions = '<button class="btn btn-sm btn-outline" onclick="showEditLot(\'' + escapeHtml(l.id) + '\')">Edit</button>';
              if (l.is_active !== 0 && l.status !== 'occupied') actions += ' <button class="btn btn-sm btn-danger" onclick="deactivateLot(\'' + escapeHtml(l.id) + '\')">Deactivate</button>';
              if (l.is_active === 0) actions += ' <button class="btn btn-sm btn-success" onclick="activateLot(\'' + escapeHtml(l.id) + '\')">Activate</button>';
              return '<tr style="' + (l.is_active === 0 ? 'opacity:0.5' : '') + '">'
                + '<td><strong>' + escapeHtml(l.id) + '</strong></td>'
                + '<td>' + escapeHtml(l.row_letter) + '</td>'
                + '<td>' + l.lot_number + '</td>'
                + '<td><span class="badge" style="background:' + typeColor + ';color:#fff;font-size:0.65rem">' + escapeHtml(l.lot_type || 'standard') + '</span></td>'
                + '<td>' + l.width + 'x' + l.length + (l.size_restriction ? ' <small>(' + escapeHtml(l.size_restriction) + ')</small>' : '') + '</td>'
                + '<td>' + (amenities || '<span style="color:#999">—</span>') + '</td>'
                + '<td>' + formatMoney(l.default_rate || 295) + '</td>'
                + '<td><span class="badge badge-' + statusBadge + '">' + l.status + '</span></td>'
                + '<td>' + (l.tenant_id ? escapeHtml(l.first_name + ' ' + l.last_name) : '—') + '</td>'
                + '<td class="btn-group">' + actions + '</td>'
                + '</tr>';
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card mt-2" style="border-left:4px solid var(--primary)">
      <h3>Default Rates by Lot Type</h3>
      <p><small>These rates auto-fill when creating new lots.</small></p>
      <div class="form-row mt-1">
        <div class="form-group"><label>Standard ($/mo)</label><input type="number" step="0.01" id="rate-standard" value="${defaultStandard}"></div>
        <div class="form-group"><label>Premium ($/mo)</label><input type="number" step="0.01" id="rate-premium" value="${defaultPremium}"></div>
        <div class="form-group"><label>Pull-Through ($/mo)</label><input type="number" step="0.01" id="rate-pullthrough" value="${defaultPullThrough}"></div>
      </div>
      <button class="btn btn-primary mt-1" onclick="saveDefaultRates()">Save Default Rates</button>
    </div>
  `;
}

function lotForm(lot = {}) {
  const isEdit = !!lot.id;
  return `
    <form onsubmit="${isEdit ? `updateLot(event, '${lot.id}')` : 'createLot(event)'}">
      <div class="form-row">
        <div class="form-group"><label>Lot ID (e.g. I1)</label><input name="id" value="${lot.id || ''}" ${isEdit ? 'readonly style="background:#f3f4f6"' : 'required'} placeholder="I1"></div>
        <div class="form-group"><label>Row Letter</label><input name="row_letter" value="${lot.row_letter || ''}" required maxlength="2" placeholder="I"></div>
        <div class="form-group"><label>Lot Number</label><input name="lot_number" type="number" value="${lot.lot_number || 1}" required min="1"></div>
      </div>
      ${isEdit ? '<div style="margin-bottom:0.75rem"><button type="button" class="btn btn-sm btn-outline" id="rename-lot-btn">🏷️ Rename/Relabel Lot ID</button></div>' : ''}
      <div class="form-row">
        <div class="form-group">
          <label>Lot Type</label>
          <select name="lot_type" onchange="lotTypeChanged(this)">
            <option value="standard" ${(lot.lot_type||'standard')==='standard'?'selected':''}>Standard</option>
            <option value="premium" ${lot.lot_type==='premium'?'selected':''}>Premium</option>
            <option value="pull-through" ${lot.lot_type==='pull-through'?'selected':''}>Pull-Through</option>
            <option value="owner_reserved" ${lot.lot_type==='owner_reserved'?'selected':''}>Owner Reserved</option>
          </select>
        </div>
        <div class="form-group"><label>Default Monthly Rate ($)</label><input name="default_rate" type="number" step="0.01" value="${lot.default_rate || 295}" id="lot-default-rate"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Width (ft)</label><input name="width" type="number" value="${lot.width || 30}"></div>
        <div class="form-group"><label>Length (ft)</label><input name="length" type="number" value="${lot.length || 60}"></div>
      </div>
      <div class="form-group"><label>Size Restriction</label><input name="size_restriction" value="${lot.size_restriction || ''}" placeholder="e.g. 25ft & under only"></div>
      <fieldset style="border:1px solid #ddd;padding:0.75rem;margin:0.75rem 0;border-radius:6px">
        <legend><strong>Amenities</strong></legend>
        <div style="display:flex;flex-wrap:wrap;gap:0.75rem">
          ${['30amp','50amp','Water','Sewer','WiFi','Cable'].map(a => {
            const checked = (lot.amenities || '').split(',').map(s=>s.trim()).includes(a);
            return `<label style="display:flex;align-items:center;gap:0.4rem"><input type="checkbox" name="amenity" value="${a}" ${checked ? 'checked' : ''}> ${a}</label>`;
          }).join('')}
        </div>
      </fieldset>
      ${isEdit ? `
      <div class="form-group">
        <label>Status</label>
        <select name="status">
          <option value="vacant" ${lot.status==='vacant'?'selected':''}>Vacant</option>
          <option value="occupied" ${lot.status==='occupied'?'selected':''}>Occupied</option>
          <option value="owner_reserved" ${lot.status==='owner_reserved'?'selected':''}>Owner Reserved</option>
          <option value="maintenance" ${lot.status==='maintenance'?'selected':''}>Maintenance</option>
        </select>
      </div>` : ''}
      <div class="form-group"><label>Notes</label><textarea name="notes">${lot.notes || ''}</textarea></div>
      <button type="submit" class="btn btn-primary btn-full mt-2">${isEdit ? 'Update' : 'Create'} Lot</button>
      <p id="lot-form-error" class="error-text" style="display:none"></p>
    </form>
  `;
}

function showAddLot() {
  showModal('Add New Lot', lotForm());
}

async function showEditLot(id) {
  const lots = await API.get('/lots');
  const lot = lots?.find(l => l.id === id);
  if (!lot) return;
  showModal('Edit Lot ' + id, lotForm(lot));
  // Wire rename button via addEventListener (CSP-safe)
  setTimeout(function() {
    var renameBtn = document.getElementById('rename-lot-btn');
    if (renameBtn) renameBtn.addEventListener('click', function() { showRenameLot(id); });
  }, 100);
}

async function createLot(e) {
  e.preventDefault();
  const errEl = document.getElementById('lot-form-error');
  if (errEl) errEl.style.display = 'none';
  const form = new FormData(e.target);
  const amenities = form.getAll('amenity').join(',');
  const data = {
    id: form.get('id'),
    row_letter: form.get('row_letter'),
    lot_number: parseInt(form.get('lot_number')),
    lot_type: form.get('lot_type'),
    default_rate: parseFloat(form.get('default_rate')),
    width: parseInt(form.get('width')),
    length: parseInt(form.get('length')),
    size_restriction: form.get('size_restriction'),
    amenities,
    notes: form.get('notes'),
  };
  try {
    await API.post('/lots', data);
    closeModal();
    showStatusToast('\u2705', `Lot ${data.id} created!`);
    loadLotMgmt();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.style.display = ''; }
  }
}

async function updateLot(e, id) {
  e.preventDefault();
  const errEl = document.getElementById('lot-form-error');
  if (errEl) errEl.style.display = 'none';
  const form = new FormData(e.target);
  const amenities = form.getAll('amenity').join(',');
  const data = {
    row_letter: form.get('row_letter'),
    lot_number: parseInt(form.get('lot_number')),
    lot_type: form.get('lot_type'),
    default_rate: parseFloat(form.get('default_rate')),
    width: parseInt(form.get('width')),
    length: parseInt(form.get('length')),
    size_restriction: form.get('size_restriction'),
    status: form.get('status'),
    amenities,
    notes: form.get('notes'),
  };
  try {
    await API.put(`/lots/${id}`, data);
    closeModal();
    showStatusToast('\u2705', `Lot ${id} updated!`);
    loadLotMgmt();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.style.display = ''; }
  }
}

async function deactivateLot(id) {
  if (!confirm(`Deactivate lot ${id}? It will be hidden from check-in and reservations.`)) return;
  try {
    await API.post(`/lots/${id}/deactivate`, {});
    showStatusToast('\u2705', `Lot ${id} deactivated`);
    loadLotMgmt();
  } catch (err) { alert(err.message); }
}

async function activateLot(id) {
  try {
    await API.post(`/lots/${id}/activate`, {});
    showStatusToast('\u2705', `Lot ${id} activated`);
    loadLotMgmt();
  } catch (err) { alert(err.message); }
}

function lotTypeChanged(sel) {
  const rateInput = document.getElementById('lot-default-rate');
  if (!rateInput) return;
  const rates = { standard: '295', premium: '350', 'pull-through': '325', owner_reserved: '0' };
  rateInput.value = rates[sel.value] || '295';
}

async function saveDefaultRates() {
  try {
    await API.put('/settings', {
      default_rate_standard: document.getElementById('rate-standard')?.value || '295',
      default_rate_premium: document.getElementById('rate-premium')?.value || '350',
      default_rate_pullthrough: document.getElementById('rate-pullthrough')?.value || '325',
    });
    showStatusToast('\u2705', 'Default rates saved!');
  } catch (err) { alert('Failed: ' + (err.message || 'unknown')); }
}

async function showRenameLot(oldId) {
  // First do a dry run to get counts
  try {
    var dryRun = await API.post('/lots/' + oldId + '/rename', { new_id: 'DRY', dry_run: true });
    var c = dryRun.counts || {};
  } catch { var c = {}; }

  closeModal();
  showModal('🏷️ Rename Lot ' + oldId, '<div>' +
    '<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:0.75rem;margin-bottom:1rem;font-size:0.85rem;color:#92400e">' +
      '⚠️ <strong>Warning:</strong> Changing a Lot ID will update all tenant records, invoices, meter readings, and reservations linked to this lot. This cannot be undone.' +
    '</div>' +
    '<div class="form-group"><label>Current Lot ID</label><input value="' + oldId + '" readonly style="background:#f3f4f6;font-weight:700;font-size:1.1rem"></div>' +
    '<div class="form-group"><label>New Lot ID</label><input id="rename-new-id" placeholder="e.g. A2" style="font-weight:700;font-size:1.1rem" autofocus></div>' +
    '<div style="font-size:0.82rem;color:var(--gray-500);margin-bottom:1rem">' +
      'Records that will be updated:<br>' +
      '• ' + (c.tenants || 0) + ' tenant records<br>' +
      '• ' + (c.invoices || 0) + ' invoices<br>' +
      '• ' + (c.meters || 0) + ' meter readings<br>' +
      '• ' + (c.checkins || 0) + ' check-in records<br>' +
      '• ' + (c.reservations || 0) + ' reservations' +
    '</div>' +
    '<div class="form-group"><label>Type CONFIRM to proceed</label><input id="rename-confirm" placeholder="CONFIRM"></div>' +
    '<button id="rename-submit-btn" class="btn btn-danger btn-full" disabled>Rename Lot</button>' +
    '<p id="rename-error" class="error-text" style="display:none"></p>' +
  '</div>');

  setTimeout(function() {
    var confirmInput = document.getElementById('rename-confirm');
    var submitBtn = document.getElementById('rename-submit-btn');
    if (confirmInput && submitBtn) {
      confirmInput.addEventListener('input', function() {
        submitBtn.disabled = this.value !== 'CONFIRM';
      });
      submitBtn.addEventListener('click', function() { executeRenameLot(oldId); });
    }
  }, 100);
}

async function executeRenameLot(oldId) {
  var newId = (document.getElementById('rename-new-id')?.value || '').trim().toUpperCase();
  var errEl = document.getElementById('rename-error');
  if (!newId) { if (errEl) { errEl.textContent = 'Enter a new lot ID'; errEl.style.display = ''; } return; }
  if (newId === oldId) { if (errEl) { errEl.textContent = 'New ID is the same as current'; errEl.style.display = ''; } return; }
  try {
    var result = await API.post('/lots/' + oldId + '/rename', { new_id: newId });
    closeModal();
    showStatusToast('\u2705', 'Lot renamed: ' + oldId + ' → ' + result.newId);
    loadLotMgmt();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Rename failed'; errEl.style.display = ''; }
  }
}
