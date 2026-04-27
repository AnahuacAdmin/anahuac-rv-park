/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
async function loadMeters() {
  const [readings, tenants] = await Promise.all([API.get('/meters/latest'), API.get('/tenants')]);
  if (!readings) return;

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('meters')}
    <div class="page-header">
      <h2>Meter Readings</h2>
      <div class="btn-group">
        <button class="btn btn-success" onclick="startMobileEntry()">Mobile Entry</button>
        <button class="btn btn-warning" onclick="showQuickAddReading()">+ Quick Add</button>
        <button class="btn btn-primary" onclick="showAddReading()">+ New Reading</button>
      </div>
    </div>
    <div class="card scrollable-table-card">
      <div class="table-container">
        <table>
          <thead><tr><th>Lot</th><th>Guest</th><th>Date</th><th>Previous</th><th>Current</th><th>Prev Photo</th><th>Curr Photo</th><th>kWh</th><th>Charge</th><th>Actions</th></tr></thead>
          <tbody>
            ${readings.map(r => {
              var tenantName = escapeHtml(r.first_name + ' ' + r.last_name);
              var lotId = escapeHtml(r.lot_id);
              // Previous month photo
              var prevPhotoCell = r.prev_id && r.prev_photo
                ? '<img src="/api/meters/' + r.prev_id + '/photo" class="meter-thumb" onclick="showDualPhotoLightbox(' + (r.prev_id||0) + ',' + r.id + ',\'' + lotId + '\',\'' + tenantName + '\')" onerror="this.outerHTML=\'<span style=color:#d6d3d1;font-size:0.7rem>—</span>\'">'
                : '<span style="color:#d6d3d1;font-size:0.7rem">—</span>';
              // Current month photo
              var currPhotoCell = r.photo
                ? '<img src="/api/meters/' + r.id + '/photo" class="meter-thumb" onclick="showDualPhotoLightbox(' + (r.prev_id||0) + ',' + r.id + ',\'' + lotId + '\',\'' + tenantName + '\')" onerror="this.outerHTML=\'<span style=color:#a8a29e;font-size:0.7rem>📷</span>\'">'
                : '<label style="cursor:pointer;display:inline-flex;align-items:center;gap:2px;font-size:0.7rem;color:#a8a29e" title="Take photo"><input type="file" accept="image/*" capture="environment" style="display:none" onchange="autoUploadPhoto(this,' + r.id + ',\'' + lotId + '\')">📷+</label>';
              return `
              <tr data-meter-id="${r.id}" data-prev="${r.previous_reading}" data-rate="${r.rate_per_kwh}">
                <td><strong>${r.lot_id}</strong></td>
                <td>${r.first_name} ${r.last_name}</td>
                <td class="editable-cell" data-id="${r.id}" data-field="reading_date" data-type="date" data-value="${r.reading_date || ''}"><span class="editable-display">${formatDate(r.reading_date)}</span><span class="edit-pencil">&#9998;</span></td>
                <td>${r.previous_reading.toLocaleString()}</td>
                <td class="editable-cell" data-id="${r.id}" data-field="current_reading" data-type="number" data-value="${r.current_reading}"><span class="editable-display">${r.current_reading.toLocaleString()}</span><span class="edit-pencil">&#9998;</span></td>
                <td>${prevPhotoCell}</td>
                <td id="photo-cell-${r.id}">${currPhotoCell}</td>
                <td class="meter-kwh"><strong>${r.kwh_used.toLocaleString()}</strong></td>
                <td class="meter-charge"><strong>${formatMoney(r.electric_charge)}</strong></td>
                <td class="btn-group">
                  <button class="btn btn-sm btn-success" onclick="showQuickUpdate(${r.id}, '${r.lot_id}', '${r.first_name} ${r.last_name}', ${r.current_reading}, ${r.tenant_id})">Update</button>
                  <button class="btn btn-sm btn-outline" onclick="showEditReading(${r.id}, '${r.lot_id}', ${r.previous_reading}, ${r.current_reading}, '${r.reading_date}')">Edit</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card mt-2">
      <h3>Total Electric: ${formatMoney(readings.reduce((s, r) => s + r.electric_charge, 0))}</h3>
      <p>Total kWh: ${readings.reduce((s, r) => s + r.kwh_used, 0).toLocaleString()}</p>
    </div>
  `;
}

// Inline editing for meter readings table (same pattern as billing)
document.addEventListener('click', (e) => {
  // Only handle editable-cell clicks inside the meters table
  const cell = e.target.closest('.editable-cell');
  if (!cell || cell.classList.contains('editing')) return;
  if (e.target.closest('button')) return;
  // Check we're in the meters page context
  const row = cell.closest('tr[data-meter-id]');
  if (!row) return;
  startMeterInlineEdit(cell, row);
});

function startMeterInlineEdit(cell, row) {
  cell.classList.add('editing');
  const field = cell.dataset.field;
  const type = cell.dataset.type;
  const value = cell.dataset.value;
  const original = cell.innerHTML;
  const meterId = cell.dataset.id;

  const input = document.createElement('input');
  input.type = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';
  if (type === 'number') input.step = '0.01';
  input.value = value;
  input.className = 'inline-edit-input';
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  let saving = false;
  const cancel = () => { cell.innerHTML = original; cell.classList.remove('editing'); };
  const commit = async () => {
    if (saving) return;
    saving = true;
    const newVal = type === 'number' ? (parseFloat(input.value) || 0) : input.value;
    if (String(newVal) === String(value)) { cancel(); return; }
    try {
      const prev = parseFloat(row.dataset.prev) || 0;
      const rate = parseFloat(row.dataset.rate) || 0.15;
      const data = { reading_date: row.querySelector('[data-field="reading_date"]')?.dataset.value };

      if (field === 'current_reading') {
        data.current_reading = newVal;
        data.previous_reading = prev;
      } else if (field === 'reading_date') {
        data.reading_date = newVal;
        data.current_reading = parseFloat(row.querySelector('[data-field="current_reading"]')?.dataset.value) || 0;
        data.previous_reading = prev;
      }

      await API.put(`/meters/${meterId}`, data);

      // Update the row in-place
      if (field === 'current_reading') {
        const kwh = Math.max(0, newVal - prev);
        const charge = (kwh * rate).toFixed(2);
        cell.dataset.value = newVal;
        cell.innerHTML = `<span class="editable-display">${Number(newVal).toLocaleString()}</span><span class="edit-pencil">&#9998;</span>`;
        row.querySelector('.meter-kwh').innerHTML = `<strong>${kwh.toLocaleString()}</strong>`;
        row.querySelector('.meter-charge').innerHTML = `<strong>${formatMoney(parseFloat(charge))}</strong>`;
      } else if (field === 'reading_date') {
        cell.dataset.value = newVal;
        cell.innerHTML = `<span class="editable-display">${formatDate(newVal)}</span><span class="edit-pencil">&#9998;</span>`;
      }
      cell.classList.remove('editing');
    } catch (err) {
      alert('Save failed: ' + (err.message || 'unknown'));
      cancel();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

async function showAddReading() {
  const tenants = await API.get('/tenants');
  showModal('New Meter Reading', `
    <form onsubmit="saveReading(event)">
      <div class="form-group">
        <label>Guest / Lot</label>
        <select name="tenant_select" required onchange="meterTenantSelected(this)">
          <option value="">Select guest...</option>
          ${tenants.map(t => `<option value="${t.id}|${t.lot_id}">${t.lot_id} - ${t.first_name} ${t.last_name}</option>`).join('')}
        </select>
        <input type="hidden" name="tenant_id">
        <input type="hidden" name="lot_id">
      </div>
      <div class="form-group"><label>Reading Date</label><input name="reading_date" type="date" value="${new Date().toISOString().split('T')[0]}" required></div>
      <div class="form-row">
        <div class="form-group"><label>Previous Reading</label><input name="previous_reading" type="number" step="0.01" value="0" required></div>
        <div class="form-group"><label>Current Reading</label><input name="current_reading" type="number" step="0.01" required></div>
      </div>
      <button type="submit" class="btn btn-primary btn-full mt-2">Save Reading</button>
    </form>
  `);
}

function meterTenantSelected(sel) {
  const [tid, lid] = sel.value.split('|');
  sel.form.tenant_id.value = tid;
  sel.form.lot_id.value = lid;
}

async function saveReading(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = {
    tenant_id: parseInt(form.get('tenant_id')),
    lot_id: form.get('lot_id'),
    reading_date: form.get('reading_date'),
    previous_reading: parseFloat(form.get('previous_reading')),
    current_reading: parseFloat(form.get('current_reading'))
  };
  await API.post('/meters', data);
  closeModal();
  loadMeters();
}

function showEditReading(id, lotId, prev, curr, date) {
  showModal('Edit Reading', `
    <form onsubmit="updateReading(event, ${id})">
      <p><strong>Lot:</strong> ${lotId}</p>
      <div class="form-group"><label>Reading Date</label><input name="reading_date" type="date" value="${date}" required></div>
      <div class="form-row">
        <div class="form-group"><label>Previous Reading</label><input name="previous_reading" type="number" step="0.01" value="${prev}" required></div>
        <div class="form-group"><label>Current Reading</label><input name="current_reading" type="number" step="0.01" value="${curr}" required></div>
      </div>
      <button type="submit" class="btn btn-primary btn-full mt-2">Update</button>
    </form>
  `);
}

async function updateReading(e, id) {
  e.preventDefault();
  const form = new FormData(e.target);
  await API.put(`/meters/${id}`, {
    reading_date: form.get('reading_date'),
    previous_reading: parseFloat(form.get('previous_reading')),
    current_reading: parseFloat(form.get('current_reading'))
  });
  closeModal();
  loadMeters();
}

// Quick Update: opens a fast modal for entering a new reading for an existing lot.
// Pre-fills previous reading from the current value, auto-calculates kWh/charge.
function showQuickUpdate(readingId, lotId, tenantName, lastReading, tenantId) {
  const today = new Date().toISOString().split('T')[0];
  showModal(`Update ${lotId} — ${tenantName}`, `
    <form onsubmit="saveQuickUpdate(event, '${lotId}', ${tenantId})">
      <div class="form-group">
        <label>Previous Reading</label>
        <input type="number" step="0.01" value="${lastReading}" readonly style="background:#f3f4f6;font-size:1.3rem;text-align:center;font-weight:700">
        <input type="hidden" name="previous_reading" value="${lastReading}">
      </div>
      <div class="form-group">
        <label>New Current Reading</label>
        <input name="current_reading" type="number" step="0.01" required inputmode="decimal" autofocus
          style="font-size:1.5rem;text-align:center;font-weight:700;padding:0.85rem"
          oninput="quickCalc(this, ${lastReading})">
      </div>
      <div id="quick-calc" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:0.5rem 1rem;margin-bottom:1rem;font-size:0.95rem;color:#92400e;display:none">
        <span id="quick-kwh"></span> kWh = <strong id="quick-charge"></strong>
      </div>
      <div class="form-group">
        <label>Reading Date</label>
        <input name="reading_date" type="date" value="${today}" required>
      </div>
      <div class="form-group">
        <label class="btn btn-outline" style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer">
          &#128247; Take Photo
          <input type="file" accept="image/*" capture="environment" style="display:none" name="photo_file" onchange="quickPhotoPreview(this)">
        </label>
        <img id="quick-photo-preview" style="display:none;width:80px;height:60px;object-fit:cover;border-radius:6px;margin-left:0.5rem;vertical-align:middle">
      </div>
      <input type="hidden" name="photo_base64" id="quick-photo-b64">
      <button type="submit" class="btn btn-success btn-full mt-1" style="font-size:1.1rem;padding:0.85rem">Save Reading</button>
    </form>
  `);
  setTimeout(() => document.querySelector('#modal-body [name="current_reading"]')?.focus(), 100);
}

function quickCalc(input, prev) {
  const curr = parseFloat(input.value);
  const el = document.getElementById('quick-calc');
  if (isNaN(curr) || curr <= prev) { el.style.display = 'none'; return; }
  const kwh = curr - prev;
  document.getElementById('quick-kwh').textContent = kwh.toLocaleString();
  document.getElementById('quick-charge').textContent = '$' + (kwh * (_mobileRate || 0.15)).toFixed(2);
  el.style.display = '';
}

function quickPhotoPreview(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1024 / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      document.getElementById('quick-photo-b64').value = dataUrl.split(',')[1] || '';
      const preview = document.getElementById('quick-photo-preview');
      preview.src = dataUrl;
      preview.style.display = 'inline';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveQuickUpdate(e, lotId, tenantId) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = {
    tenant_id: tenantId,
    lot_id: lotId,
    reading_date: form.get('reading_date'),
    previous_reading: parseFloat(form.get('previous_reading')),
    current_reading: parseFloat(form.get('current_reading')),
  };
  const photoB64 = form.get('photo_base64');
  if (photoB64) data.photo = photoB64;
  try {
    await API.post('/meters', data);
    closeModal();
    showStatusToast('✅', `${lotId} reading saved!`);
    loadMeters();
  } catch (err) {
    alert('Save failed: ' + (err.message || 'unknown'));
  }
}

// Quick Add: pick a lot from dropdown, auto-fills previous from last known reading.
async function showQuickAddReading() {
  const readings = await API.get('/meters/latest');
  if (!readings || !readings.length) { alert('No lots with active tenants found.'); return; }
  const today = new Date().toISOString().split('T')[0];
  showModal('Quick Add Reading', `
    <form onsubmit="saveQuickUpdate(event, document.getElementById('qa-lot').value, parseInt(document.getElementById('qa-tenant').value))">
      <div class="form-group">
        <label>Lot / Guest</label>
        <select id="qa-select" required onchange="qaSelected(this)">
          <option value="">Select lot...</option>
          ${readings.map(r => `<option value="${r.lot_id}|${r.tenant_id}|${r.current_reading}">${r.lot_id} — ${r.first_name} ${r.last_name} (last: ${r.current_reading.toLocaleString()})</option>`).join('')}
        </select>
        <input type="hidden" id="qa-lot" name="lot_placeholder">
        <input type="hidden" id="qa-tenant">
      </div>
      <div class="form-group">
        <label>Previous Reading</label>
        <input type="number" step="0.01" id="qa-prev" readonly style="background:#f3f4f6;font-size:1.3rem;text-align:center;font-weight:700" value="0">
        <input type="hidden" name="previous_reading" id="qa-prev-hidden" value="0">
      </div>
      <div class="form-group">
        <label>New Current Reading</label>
        <input name="current_reading" type="number" step="0.01" required inputmode="decimal"
          style="font-size:1.5rem;text-align:center;font-weight:700;padding:0.85rem"
          oninput="quickCalc(this, parseFloat(document.getElementById('qa-prev').value) || 0)">
      </div>
      <div id="quick-calc" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:0.5rem 1rem;margin-bottom:1rem;font-size:0.95rem;color:#92400e;display:none">
        <span id="quick-kwh"></span> kWh = <strong id="quick-charge"></strong>
      </div>
      <div class="form-group">
        <label>Reading Date</label>
        <input name="reading_date" type="date" value="${today}" required>
      </div>
      <div class="form-group">
        <label class="btn btn-outline" style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer">
          &#128247; Take Photo
          <input type="file" accept="image/*" capture="environment" style="display:none" name="photo_file" onchange="quickPhotoPreview(this)">
        </label>
        <img id="quick-photo-preview" style="display:none;width:80px;height:60px;object-fit:cover;border-radius:6px;margin-left:0.5rem;vertical-align:middle">
      </div>
      <input type="hidden" name="photo_base64" id="quick-photo-b64">
      <button type="submit" class="btn btn-success btn-full mt-1" style="font-size:1.1rem;padding:0.85rem">Save Reading</button>
    </form>
  `);
}

function qaSelected(sel) {
  const parts = sel.value.split('|');
  document.getElementById('qa-lot').value = parts[0] || '';
  document.getElementById('qa-tenant').value = parts[1] || '';
  const prev = parseFloat(parts[2]) || 0;
  document.getElementById('qa-prev').value = prev;
  document.getElementById('qa-prev-hidden').value = prev;
}

function viewReadingPhoto(id) {
  showModal('Meter Photo', '<img src="/api/meters/' + id + '/photo" style="width:100%;border-radius:8px" onerror="this.parentElement.innerHTML=\'<p>Photo not available.</p>\'">');
}

function showMeterPhotoLightbox(id, lotId, tenantName, date, prev, curr, kwh, charge) {
  showModal('📷 Meter Photo — Lot ' + lotId, '<div style="text-align:center">' +
    '<img src="/api/meters/' + id + '/photo" style="width:100%;max-height:60vh;object-fit:contain;border-radius:10px;margin-bottom:1rem" onerror="this.outerHTML=\'<p style=color:#dc2626>Photo not available.</p>\'">' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;text-align:left;font-size:0.88rem;background:var(--gray-50,#fafaf9);padding:0.75rem;border-radius:8px">' +
      '<div><strong>Lot:</strong> ' + escapeHtml(lotId) + '</div>' +
      '<div><strong>Guest:</strong> ' + escapeHtml(tenantName) + '</div>' +
      '<div><strong>Date:</strong> ' + formatDate(date) + '</div>' +
      '<div><strong>Previous:</strong> ' + Number(prev).toLocaleString() + '</div>' +
      '<div><strong>Current:</strong> ' + Number(curr).toLocaleString() + '</div>' +
      '<div><strong>kWh Used:</strong> ' + Number(kwh).toLocaleString() + '</div>' +
      '<div><strong>Charge:</strong> ' + formatMoney(charge) + '</div>' +
    '</div></div>');
}

function showDualPhotoLightbox(prevId, currId, lotId, tenantName) {
  var prevImg = prevId
    ? '<div style="flex:1;text-align:center"><div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);margin-bottom:0.4rem">Previous Month</div><img src="/api/meters/' + prevId + '/photo" style="width:100%;max-height:45vh;object-fit:contain;border-radius:8px;border:1px solid var(--gray-200,#e7e5e4)" onerror="this.outerHTML=\'<p style=color:#a8a29e>No previous photo</p>\'"></div>'
    : '<div style="flex:1;text-align:center"><div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);margin-bottom:0.4rem">Previous Month</div><p style="color:#a8a29e;padding:2rem 0">No photo</p></div>';
  var currImg = currId
    ? '<div style="flex:1;text-align:center"><div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);margin-bottom:0.4rem">Current Month</div><img src="/api/meters/' + currId + '/photo" style="width:100%;max-height:45vh;object-fit:contain;border-radius:8px;border:1px solid var(--gray-200,#e7e5e4)" onerror="this.outerHTML=\'<p style=color:#a8a29e>No current photo</p>\'"></div>'
    : '<div style="flex:1;text-align:center"><div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);margin-bottom:0.4rem">Current Month</div><p style="color:#a8a29e;padding:2rem 0">No photo</p></div>';
  showModal('📷 Meter Photos — Lot ' + lotId,
    '<p style="text-align:center;font-size:0.88rem;margin-bottom:0.75rem"><strong>' + tenantName + '</strong></p>' +
    '<div class="meter-dual-photos">' + prevImg + currImg + '</div>');
}

// Instant photo upload from table or mobile
async function autoUploadPhoto(input, readingId, lotId) {
  var file = input.files && input.files[0];
  if (!file) return;
  var cell = document.getElementById('photo-cell-' + readingId);
  if (cell) cell.innerHTML = '<span style="font-size:0.75rem;color:#f59e0b">⏳ Uploading...</span>';

  // Compress and convert to base64
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var scale = Math.min(1, 1024 / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      var base64 = dataUrl.split(',')[1] || '';

      // Upload via existing meter update endpoint
      API.put('/meters/' + readingId, { photo: base64 }).then(function() {
        if (cell) cell.innerHTML = '<img src="/api/meters/' + readingId + '/photo?t=' + Date.now() + '" class="meter-thumb" onclick="showMeterPhotoLightbox(' + readingId + ',\'' + escapeHtml(lotId) + '\',\'\',\'\',0,0,0,0)">';
        showStatusToast('✅', lotId + ' photo saved');
      }).catch(function(err) {
        if (cell) cell.innerHTML = '<span style="font-size:0.75rem;color:#dc2626">❌ Failed</span>';
        console.error('Photo upload failed:', err);
      });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function deleteReading(id) {
  if (!confirm('Delete this reading?')) return;
  await API.del(`/meters/${id}`);
  loadMeters();
}

// --- Mobile Meter Entry Mode ---
// Shows one lot at a time, fullscreen-ish, with camera capture and auto-calc.
let _mobileReadings = [];
let _mobileIndex = 0;
let _mobileCompleted = new Set();
let _mobilePhoto = null;
let _mobileRate = 0.15;

async function startMobileEntry() {
  const readings = await API.get('/meters/latest');
  if (!readings || !readings.length) { alert('No lots with active tenants found.'); return; }
  _mobileReadings = readings;
  _mobileIndex = 0;
  _mobileCompleted = new Set();
  _mobilePhoto = null;
  // Fetch current electric rate
  try {
    const settings = await API.get('/settings');
    _mobileRate = parseFloat(settings?.electric_rate) || 0.15;
  } catch { _mobileRate = 0.15; }
  renderMobileEntry();
}

function renderMobileEntry() {
  const r = _mobileReadings[_mobileIndex];
  const total = _mobileReadings.length;
  const done = _mobileCompleted.size;
  const pct = Math.round((done / total) * 100);
  const today = new Date().toISOString().split('T')[0];
  const isDone = _mobileCompleted.has(r.id);

  document.getElementById('page-content').innerHTML = `
    <div class="mobile-meter">
      <div class="mobile-meter-progress">
        <div class="mobile-meter-progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="mobile-meter-progress-text">${done} of ${total} completed</div>

      <div class="mobile-meter-card ${isDone ? 'done' : ''}">
        <div class="mobile-meter-header">
          <span class="mobile-meter-lot">${r.lot_id}</span>
          <span class="mobile-meter-tenant">${r.first_name} ${r.last_name}</span>
          ${isDone ? '<span class="badge badge-success">Saved</span>' : ''}
        </div>

        <div class="mobile-meter-photo-area">
          ${_mobilePhoto ? `
            <img src="${_mobilePhoto}" class="mobile-meter-preview" alt="Meter photo" onclick="viewMobilePhoto()">
            <button type="button" class="btn btn-sm btn-danger" onclick="clearMobilePhoto()">&#10005; Delete</button>
          ` : ''}
          <label class="btn btn-outline mobile-meter-camera-btn">
            &#128247; ${_mobilePhoto ? 'Retake' : 'Take Photo'}
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="captureMeterPhoto(this)">
          </label>
        </div>

        <div class="form-group">
          <label>Previous Reading</label>
          <input type="number" step="0.01" id="mobile-prev" value="${r.current_reading}" readonly style="background:#f3f4f6">
        </div>
        <div class="form-group">
          <label>Current Reading</label>
          <input type="number" step="0.01" id="mobile-curr" placeholder="Enter reading..."
            oninput="calcMobileKwh()" inputmode="decimal" autofocus>
        </div>
        <div class="mobile-meter-calc" id="mobile-calc" style="display:none">
          <span id="mobile-kwh"></span> kWh &times; $${_mobileRate.toFixed(2)} = <strong id="mobile-charge"></strong>
        </div>

        <button class="btn btn-primary btn-full mt-2" onclick="saveMobileReading()" id="mobile-save-btn" ${isDone ? 'disabled' : ''}>
          ${isDone ? 'Saved' : 'Save Reading'}
        </button>

        <div class="mobile-meter-nav mt-2">
          <button class="btn btn-outline" onclick="mobilePrev()" ${_mobileIndex === 0 ? 'disabled' : ''}>&larr; Previous</button>
          <span class="mobile-meter-counter">${_mobileIndex + 1} / ${total}</span>
          <button class="btn btn-outline" onclick="mobileNext()" ${_mobileIndex === total - 1 ? 'disabled' : ''}>Next &rarr;</button>
        </div>
      </div>

      <button class="btn btn-outline btn-full mt-2" onclick="loadMeters()">Exit Mobile Entry</button>
    </div>
  `;

  // Auto-focus current reading input after render.
  setTimeout(() => document.getElementById('mobile-curr')?.focus(), 100);
}

function calcMobileKwh() {
  const prev = parseFloat(document.getElementById('mobile-prev').value) || 0;
  const curr = parseFloat(document.getElementById('mobile-curr').value);
  const calcDiv = document.getElementById('mobile-calc');
  if (isNaN(curr) || curr === 0) { calcDiv.style.display = 'none'; return; }
  const kwh = Math.max(0, curr - prev);
  const charge = (kwh * _mobileRate).toFixed(2);
  document.getElementById('mobile-kwh').textContent = kwh.toLocaleString();
  document.getElementById('mobile-charge').textContent = '$' + charge;
  calcDiv.style.display = '';
}

function captureMeterPhoto(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    // Compress by drawing to a canvas at reduced quality.
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 1024;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      _mobilePhoto = canvas.toDataURL('image/jpeg', 0.7);
      // Re-render to show preview.
      renderMobileEntry();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearMobilePhoto() {
  _mobilePhoto = null;
  renderMobileEntry();
}

function viewMobilePhoto() {
  if (!_mobilePhoto) return;
  showModal('Meter Photo', `<img src="${_mobilePhoto}" style="width:100%;border-radius:8px">`);
}

async function saveMobileReading() {
  const r = _mobileReadings[_mobileIndex];
  const prev = parseFloat(document.getElementById('mobile-prev').value) || 0;
  const curr = parseFloat(document.getElementById('mobile-curr').value);
  if (isNaN(curr)) { alert('Please enter the current reading.'); return; }

  // Strip the data:image/jpeg;base64, prefix for storage.
  let photoBase64 = null;
  if (_mobilePhoto) {
    const idx = _mobilePhoto.indexOf(',');
    photoBase64 = idx >= 0 ? _mobilePhoto.slice(idx + 1) : _mobilePhoto;
  }

  try {
    const data = {
      tenant_id: r.tenant_id,
      lot_id: r.lot_id,
      reading_date: new Date().toISOString().split('T')[0],
      previous_reading: prev,
      current_reading: curr,
      photo: photoBase64,
    };
    await API.post('/meters', data);
    _mobileCompleted.add(r.id);
    _mobilePhoto = null;
    // Update the cached reading so if user navigates back, the new value shows.
    r.previous_reading = r.current_reading;
    r.current_reading = curr;
    r.kwh_used = Math.max(0, curr - prev);

    // Auto-advance to next if available.
    if (_mobileIndex < _mobileReadings.length - 1) {
      _mobileIndex++;
    }
    renderMobileEntry();
  } catch (err) {
    alert('Save failed: ' + (err.message || 'unknown'));
  }
}

function mobilePrev() {
  if (_mobileIndex > 0) { _mobileIndex--; _mobilePhoto = null; renderMobileEntry(); }
}
function mobileNext() {
  if (_mobileIndex < _mobileReadings.length - 1) { _mobileIndex++; _mobilePhoto = null; renderMobileEntry(); }
}
