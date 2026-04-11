async function loadMeters() {
  const [readings, tenants] = await Promise.all([API.get('/meters/latest'), API.get('/tenants')]);
  if (!readings) return;

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('meters')}
    <div class="page-header">
      <h2>Meter Readings</h2>
      <div class="btn-group">
        <button class="btn btn-success" onclick="startMobileEntry()">Mobile Entry</button>
        <button class="btn btn-primary" onclick="showAddReading()">+ New Reading</button>
      </div>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>Lot</th><th>Tenant</th><th>Date</th><th>Previous</th><th>Current</th><th>kWh Used</th><th>Rate</th><th>Charge</th><th>Actions</th></tr></thead>
          <tbody>
            ${readings.map(r => `
              <tr>
                <td><strong>${r.lot_id}</strong></td>
                <td>${r.first_name} ${r.last_name}</td>
                <td>${formatDate(r.reading_date)}</td>
                <td>${r.previous_reading}</td>
                <td>${r.current_reading}</td>
                <td><strong>${r.kwh_used}</strong></td>
                <td>${formatMoney(r.rate_per_kwh)}</td>
                <td><strong>${formatMoney(r.electric_charge)}</strong></td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="showEditReading(${r.id}, '${r.lot_id}', ${r.previous_reading}, ${r.current_reading}, '${r.reading_date}')">Edit</button>
                </td>
              </tr>
            `).join('')}
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

async function showAddReading() {
  const tenants = await API.get('/tenants');
  showModal('New Meter Reading', `
    <form onsubmit="saveReading(event)">
      <div class="form-group">
        <label>Tenant / Lot</label>
        <select name="tenant_select" required onchange="meterTenantSelected(this)">
          <option value="">Select tenant...</option>
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
