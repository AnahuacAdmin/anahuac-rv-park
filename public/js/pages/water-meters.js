/*
 * Anahuac RV Park — Water Meter Tracking
 */

var _waterTab = 'readings';
var _waterSettings = {};

async function loadWaterMeters() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }

  _waterSettings = await API.get('/water-meters/settings') || {};
  var analytics = await API.get('/water-meters/analytics') || {};
  var modeLabel = _waterSettings.evaluation_mode ? 'Evaluation' : _waterSettings.overage_only_mode ? 'Overage Only' : 'Full Billing';
  var modeBadge = _waterSettings.evaluation_mode ? 'badge-warning' : 'badge-success';

  document.getElementById('page-content').innerHTML =
    '<div class="page-header"><h2>💧 Water Meters</h2><div class="btn-group">' +
      '<button class="btn btn-primary" onclick="showEnterWaterReading()">+ Enter Reading</button>' +
      '<button class="btn btn-outline" onclick="exportWaterCSV()">📥 Export CSV</button>' +
    '</div></div>' +

    // Evaluation mode warning
    (_waterSettings.evaluation_mode ? '<div class="card" style="border-left:4px solid #f59e0b;background:#fffbeb;padding:0.75rem 1rem;margin-bottom:1rem">' +
      '<strong style="color:#92400e">⚠️ EVALUATION MODE ACTIVE</strong>' +
      '<span style="font-size:0.85rem;color:#92400e;margin-left:0.5rem">— Water usage is being tracked but tenants are NOT being charged. Switch billing mode in Settings when ready.</span></div>' : '') +

    // Summary cards
    '<div class="dash-top-bar" style="margin-bottom:1rem">' +
      '<div class="dash-top-item dash-border-blue"><div class="dash-top-icon">📊</div><span class="dash-top-val">' + (analytics.readingsCount || 0) + '/' + (analytics.totalLots || 0) + '</span><span class="dash-top-label">Lots Read This Month</span></div>' +
      '<div class="dash-top-item dash-border-blue"><div class="dash-top-icon">💧</div><span class="dash-top-val">' + formatWaterGallons(analytics.totalGallons || 0) + '</span><span class="dash-top-label">Total Gallons (Month)</span></div>' +
      '<div class="dash-top-item"><div class="dash-top-icon">📈</div><span class="dash-top-val">' + formatWaterGallons(analytics.avgPerLot || 0) + '</span><span class="dash-top-label">Avg per Lot</span></div>' +
      '<div class="dash-top-item"><div class="dash-top-icon">⚙️</div><span class="dash-top-val badge ' + modeBadge + '" style="font-size:0.7rem;padding:2px 6px">' + modeLabel + '</span><span class="dash-top-label">Billing Mode</span></div>' +
    '</div>' +

    // Tabs
    '<div style="display:flex;gap:0;margin-bottom:1rem;border-bottom:2px solid var(--gray-200)">' +
      '<button class="btn btn-sm" id="water-tab-readings" onclick="switchWaterTab(\'readings\')" style="border-radius:8px 8px 0 0;border:1px solid var(--gray-200);border-bottom:none;font-weight:600">📋 Readings</button>' +
      '<button class="btn btn-sm" id="water-tab-settings" onclick="switchWaterTab(\'settings\')" style="border-radius:8px 8px 0 0;border:1px solid var(--gray-200);border-bottom:none;font-weight:600;margin-left:-1px">⚙️ Settings</button>' +
    '</div>' +
    '<div id="water-tab-content"></div>';

  switchWaterTab(_waterTab);
}

function formatWaterGallons(g) {
  if (g >= 1000) return Math.round(g).toLocaleString();
  return String(Math.round(g));
}

function switchWaterTab(tab) {
  _waterTab = tab;
  document.getElementById('water-tab-readings')?.classList.toggle('btn-primary', tab === 'readings');
  document.getElementById('water-tab-readings')?.classList.toggle('btn-outline', tab !== 'readings');
  document.getElementById('water-tab-settings')?.classList.toggle('btn-primary', tab === 'settings');
  document.getElementById('water-tab-settings')?.classList.toggle('btn-outline', tab !== 'settings');
  if (tab === 'readings') loadWaterReadingsTab();
  else loadWaterSettingsTab();
}

async function loadWaterReadingsTab() {
  var el = document.getElementById('water-tab-content');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:2rem"><div class="loading-spinner"></div></div>';

  var month = new Date().toISOString().slice(0, 7);
  try {
    var readings = await API.get('/water-meters/readings?month=' + month);
    if (!readings || !readings.length) {
      el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">' +
        '<p style="font-size:1.2rem;margin-bottom:0.5rem">💧</p>' +
        '<p>No water readings entered this month yet.</p>' +
        '<button class="btn btn-primary" style="margin-top:0.75rem" onclick="showEnterWaterReading()">+ Enter First Reading</button></div>';
      return;
    }

    var total = readings.reduce(function(s, r) { return s + (r.gallons_used || 0); }, 0);
    el.innerHTML = '<div class="card"><div class="table-container"><table>' +
      '<thead><tr><th>Lot</th><th>Guest</th><th>Date</th><th>Prev</th><th>Current</th><th>Gallons</th><th>Est. Charge</th><th>Photo</th><th>Actions</th></tr></thead><tbody>' +
      readings.map(function(r) {
        var name = ((r.first_name || '') + ' ' + (r.last_name || '')).trim() || '—';
        var photoLink = r.has_photo ? '<a href="/api/water-meters/readings/' + r.id + '/photo" target="_blank" style="color:var(--brand-primary);font-size:0.75rem">📷 View</a>' : '<span style="color:#a8a29e">—</span>';
        return '<tr>' +
          '<td><strong>' + escapeHtml(r.lot_id) + '</strong></td>' +
          '<td>' + escapeHtml(name) + '</td>' +
          '<td>' + formatDate(r.reading_date) + '</td>' +
          '<td>' + Number(r.previous_reading).toLocaleString() + '</td>' +
          '<td>' + Number(r.current_reading).toLocaleString() + '</td>' +
          '<td><strong>' + Number(r.gallons_used).toLocaleString() + '</strong></td>' +
          '<td>' + (_waterSettings.evaluation_mode ? '<span style="color:#a8a29e">N/A</span>' : formatMoney(r.estimated_charge)) + '</td>' +
          '<td>' + photoLink + '</td>' +
          '<td class="btn-group"><button class="btn btn-sm btn-outline" onclick="editWaterReading(' + r.id + ')">Edit</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deleteWaterReading(' + r.id + ')">Del</button></td></tr>';
      }).join('') +
      '<tr style="border-top:2px solid #111"><td colspan="5"><strong>Total (' + readings.length + ' readings)</strong></td>' +
        '<td><strong>' + total.toLocaleString() + '</strong></td><td colspan="3"></td></tr>' +
      '</tbody></table></div></div>';
  } catch { el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load readings</div>'; }
}

async function showEnterWaterReading() {
  var lots = await API.get('/lots');
  var occupiedLots = (lots || []).filter(function(l) { return l.status === 'occupied'; });
  var today = new Date().toISOString().split('T')[0];

  showModal('💧 Enter Water Reading',
    '<form id="water-reading-form">' +
    '<div class="form-row"><div class="form-group"><label>Lot *</label>' +
      '<select name="lot_id" id="water-lot-select" required onchange="onWaterLotChange(this.value)">' +
        '<option value="">Select lot...</option>' +
        occupiedLots.map(function(l) {
          var tName = l.first_name ? l.first_name + ' ' + l.last_name : '';
          return '<option value="' + l.id + '">' + l.id + (tName ? ' — ' + tName : '') + '</option>';
        }).join('') +
      '</select></div>' +
    '<div class="form-group"><label>Reading Date</label><input name="reading_date" type="date" value="' + today + '" required></div></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>Previous Reading</label><input name="previous_reading" id="water-prev" type="number" step="1" value="0" readonly style="background:#f5f5f4"></div>' +
      '<div class="form-group"><label>Current Reading *</label><input name="current_reading" id="water-curr" type="number" step="1" required oninput="calcWaterUsage()"></div>' +
    '</div>' +
    '<div id="water-calc" style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.75rem;font-size:0.88rem;display:none">' +
      '<div>💧 Gallons used: <strong id="water-calc-gallons">0</strong></div>' +
      '<div>💰 Est. charge: <strong id="water-calc-charge">$0.00</strong></div>' +
    '</div>' +
    '<div class="form-group"><label>Notes</label><input name="notes" placeholder="Optional notes"></div>' +
    '<div class="form-group"><label>Meter Photo <span style="color:#a8a29e">(optional)</span></label>' +
      '<input type="file" id="water-photo-input" accept="image/*" capture="environment">' +
      '<div id="water-photo-preview" style="margin-top:0.4rem"></div>' +
    '</div>' +
    '<button type="submit" class="btn btn-primary btn-full">Save Reading</button></form>'
  );

  setTimeout(function() {
    var form = document.getElementById('water-reading-form');
    if (form) form.addEventListener('submit', submitWaterReading);
  }, 50);
}

async function onWaterLotChange(lotId) {
  if (!lotId) return;
  // Get previous reading for this lot
  try {
    var readings = await API.get('/water-meters/readings?lot_id=' + lotId);
    var prev = document.getElementById('water-prev');
    if (prev && readings && readings.length) {
      prev.value = readings[0].current_reading || 0;
    } else if (prev) {
      prev.value = 0;
    }
    calcWaterUsage();
  } catch {}
}

function calcWaterUsage() {
  var prev = Number(document.getElementById('water-prev')?.value) || 0;
  var curr = Number(document.getElementById('water-curr')?.value) || 0;
  var gallons = Math.max(0, curr - prev);
  var calcDiv = document.getElementById('water-calc');
  if (calcDiv) calcDiv.style.display = gallons > 0 ? '' : 'none';
  var gEl = document.getElementById('water-calc-gallons');
  if (gEl) gEl.textContent = gallons.toLocaleString();

  var charge = 0;
  if (!_waterSettings.evaluation_mode) {
    var rate = Number(_waterSettings.rate_per_gallon) || 0;
    var fee = Math.min(Number(_waterSettings.service_fee_percent) || 0, 9);
    var allowance = _waterSettings.monthly_allowance_gallons ? Number(_waterSettings.monthly_allowance_gallons) : null;
    var billable = gallons;
    if (_waterSettings.overage_only_mode && allowance) billable = Math.max(0, gallons - allowance);
    charge = billable * rate * (1 + fee / 100);
  }
  var cEl = document.getElementById('water-calc-charge');
  if (cEl) cEl.textContent = _waterSettings.evaluation_mode ? 'N/A (Evaluation Mode)' : '$' + charge.toFixed(2);
}

async function submitWaterReading(e) {
  e.preventDefault();
  var fd = new FormData(e.target);
  var data = {
    lot_id: fd.get('lot_id'),
    reading_date: fd.get('reading_date'),
    previous_reading: Number(fd.get('previous_reading')) || 0,
    current_reading: Number(fd.get('current_reading')) || 0,
    notes: fd.get('notes') || '',
  };

  try {
    var result = await API.post('/water-meters/readings', data);

    // Upload photo if selected
    var fileInput = document.getElementById('water-photo-input');
    if (fileInput && fileInput.files && fileInput.files[0] && result.id) {
      var reader = new FileReader();
      reader.onload = function(ev) {
        var b64 = ev.target.result.split(',')[1];
        API.post('/water-meters/readings/' + result.id + '/photo', { data: b64 }).catch(function() {});
      };
      reader.readAsDataURL(fileInput.files[0]);
    }

    closeModal();
    showStatusToast('✅', 'Water reading saved — ' + (result.gallons_used || 0).toLocaleString() + ' gallons');
    loadWaterMeters();
  } catch (err) {
    alert('Failed to save: ' + (err.message || 'unknown'));
  }
}

async function editWaterReading(id) {
  var readings = await API.get('/water-meters/readings');
  var r = (readings || []).find(function(x) { return x.id === id; });
  if (!r) return;
  showModal('Edit Water Reading',
    '<form id="water-edit-form">' +
    '<div class="form-group"><label>Lot</label><input value="' + escapeHtml(r.lot_id) + '" readonly style="background:#f5f5f4"></div>' +
    '<div class="form-row"><div class="form-group"><label>Date</label><input name="reading_date" type="date" value="' + r.reading_date + '"></div>' +
    '<div class="form-group"><label>Previous</label><input name="previous_reading" type="number" value="' + r.previous_reading + '"></div></div>' +
    '<div class="form-group"><label>Current Reading</label><input name="current_reading" type="number" value="' + r.current_reading + '"></div>' +
    '<div class="form-group"><label>Notes</label><input name="notes" value="' + escapeHtml(r.notes || '') + '"></div>' +
    '<input type="hidden" name="lot_id" value="' + r.lot_id + '">' +
    '<button type="submit" class="btn btn-primary btn-full">Update</button></form>'
  );
  setTimeout(function() {
    var form = document.getElementById('water-edit-form');
    if (form) form.addEventListener('submit', async function(ev) {
      ev.preventDefault();
      var data = Object.fromEntries(new FormData(ev.target));
      await API.put('/water-meters/readings/' + id, data);
      closeModal();
      showStatusToast('✅', 'Reading updated');
      loadWaterMeters();
    });
  }, 50);
}

async function deleteWaterReading(id) {
  if (!confirm('Delete this water reading?')) return;
  await API.del('/water-meters/readings/' + id);
  loadWaterReadingsTab();
}

function loadWaterSettingsTab() {
  var el = document.getElementById('water-tab-content');
  if (!el) return;
  var s = _waterSettings;
  var evalChecked = s.evaluation_mode ? 'checked' : '';
  var overageChecked = !s.evaluation_mode && s.overage_only_mode ? 'checked' : '';
  var fullChecked = !s.evaluation_mode && !s.overage_only_mode ? 'checked' : '';

  el.innerHTML =
    '<div class="card" style="max-width:640px">' +
    '<h3 style="margin-bottom:1rem">Water Billing Settings</h3>' +
    '<form id="water-settings-form">' +
    '<div class="form-group"><label>Rate per gallon ($)</label>' +
      '<input name="rate_per_gallon" type="number" step="0.0001" value="' + (s.rate_per_gallon || 0) + '">' +
      '<small style="color:#78716c">Your current rate from city water bill (per gallon)</small></div>' +
    '<div class="form-group"><label>Service fee %</label>' +
      '<input name="service_fee_percent" type="number" step="0.1" max="9" value="' + (s.service_fee_percent || 9) + '">' +
      '<small style="color:#78716c">Texas law allows maximum 9%</small></div>' +
    '<div class="form-group"><label>Monthly gallon allowance per lot</label>' +
      '<input name="monthly_allowance_gallons" type="number" step="1" value="' + (s.monthly_allowance_gallons || '') + '" placeholder="Leave blank for none">' +
      '<small style="color:#78716c">Leave blank for no allowance</small></div>' +

    '<div class="form-group" style="margin-top:1.25rem"><label><strong>Billing Mode</strong></label>' +
      '<div style="display:flex;flex-direction:column;gap:0.75rem;margin-top:0.5rem">' +
        '<label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;padding:0.6rem;border:1.5px solid ' + (s.evaluation_mode ? '#f59e0b' : '#e5e7eb') + ';border-radius:8px;background:' + (s.evaluation_mode ? '#fffbeb' : '#fff') + '">' +
          '<input type="radio" name="billing_mode" value="evaluation" ' + evalChecked + ' style="margin-top:3px">' +
          '<div><strong>Evaluation Mode</strong><br><span style="font-size:0.82rem;color:#78716c">Tracking usage only — tenants are NOT charged anything</span></div></label>' +
        '<label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;padding:0.6rem;border:1.5px solid ' + (!s.evaluation_mode && s.overage_only_mode ? '#1a5c32' : '#e5e7eb') + ';border-radius:8px">' +
          '<input type="radio" name="billing_mode" value="overage" ' + overageChecked + ' style="margin-top:3px">' +
          '<div><strong>Overage Only Mode</strong><br><span style="font-size:0.82rem;color:#78716c">Only charge tenants who exceed monthly allowance</span></div></label>' +
        '<label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;padding:0.6rem;border:1.5px solid ' + (!s.evaluation_mode && !s.overage_only_mode ? '#1a5c32' : '#e5e7eb') + ';border-radius:8px">' +
          '<input type="radio" name="billing_mode" value="full" ' + fullChecked + ' style="margin-top:3px">' +
          '<div><strong>Full Billing Mode</strong><br><span style="font-size:0.82rem;color:#78716c">Charge all usage like electric metering</span></div></label>' +
      '</div></div>' +
    '<button type="submit" class="btn btn-primary btn-full" style="margin-top:1.25rem">Save Settings</button></form></div>';

  setTimeout(function() {
    var form = document.getElementById('water-settings-form');
    if (form) form.addEventListener('submit', async function(ev) {
      ev.preventDefault();
      var fd = new FormData(ev.target);
      var mode = fd.get('billing_mode');
      await API.put('/water-meters/settings', {
        rate_per_gallon: fd.get('rate_per_gallon'),
        service_fee_percent: fd.get('service_fee_percent'),
        monthly_allowance_gallons: fd.get('monthly_allowance_gallons') || null,
        billing_enabled: mode !== 'evaluation' ? 1 : 0,
        evaluation_mode: mode === 'evaluation' ? 1 : 0,
        overage_only_mode: mode === 'overage' ? 1 : 0,
      });
      _waterSettings = await API.get('/water-meters/settings') || {};
      closeModal();
      showStatusToast('✅', 'Water settings saved');
      loadWaterMeters();
    });
  }, 50);
}

async function exportWaterCSV() {
  var month = new Date().toISOString().slice(0, 7);
  try {
    var res = await fetch('/api/water-meters/export/csv?month=' + month, { headers: { 'Authorization': 'Bearer ' + API.token } });
    if (!res.ok) throw new Error('Export failed');
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'water-readings-' + month + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (err) { alert('Export failed: ' + (err.message || 'unknown')); }
}
