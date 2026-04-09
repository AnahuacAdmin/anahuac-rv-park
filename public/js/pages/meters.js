async function loadMeters() {
  const [readings, tenants] = await Promise.all([API.get('/meters/latest'), API.get('/tenants')]);
  if (!readings) return;

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('meters')}
    <div class="page-header">
      <h2>Meter Readings</h2>
      <button class="btn btn-primary" onclick="showAddReading()">+ New Reading</button>
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
