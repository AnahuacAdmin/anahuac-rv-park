async function loadCheckins() {
  const [checkins, tenants, lots] = await Promise.all([
    API.get('/checkins'), API.get('/tenants'), API.get('/lots')
  ]);
  if (!checkins) return;

  const vacantLots = lots.filter(l => l.status === 'vacant');
  const activeTenants = tenants.filter(t => t.is_active);

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('checkins')}
    <div class="page-header">
      <h2>Check-In / Check-Out</h2>
      <div class="btn-group">
        <button class="btn btn-success" onclick="showCheckIn()">Check-In</button>
        <button class="btn btn-warning" onclick="showCheckOut()">Check-Out</button>
      </div>
    </div>
    <div class="stats-grid">
      <div class="stat-card success"><div class="stat-value">${activeTenants.length}</div><div class="stat-label">Currently Checked In</div></div>
      <div class="stat-card"><div class="stat-value">${vacantLots.length}</div><div class="stat-label">Available Lots</div></div>
    </div>
    <div class="card">
      <h3 class="mb-1">Activity Log</h3>
      <div class="table-container">
        <table>
          <thead><tr><th>Tenant</th><th>Lot</th><th>Check-In</th><th>Check-Out</th><th>Status</th></tr></thead>
          <tbody>
            ${checkins.length ? checkins.map(c => `
              <tr>
                <td>${c.first_name} ${c.last_name}</td>
                <td><strong>${c.lot_name}</strong></td>
                <td>${formatDate(c.check_in_date)}</td>
                <td>${c.check_out_date ? formatDate(c.check_out_date) : '—'}</td>
                <td><span class="badge badge-${c.status === 'checked_in' ? 'success' : 'gray'}">${c.status}</span></td>
              </tr>
            `).join('') : '<tr><td colspan="5" class="text-center">No check-in/out records yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function showCheckIn() {
  const lots = await API.get('/lots');
  const vacantLots = lots.filter(l => l.status === 'vacant');

  showModal('Check-In New Tenant', `
    <form onsubmit="processCheckIn(event)">
      <div class="form-row">
        <div class="form-group"><label>First Name</label><input name="first_name" required></div>
        <div class="form-group"><label>Last Name</label><input name="last_name" required></div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Assign to Lot</label>
          <select name="lot_id" required>
            <option value="">Select lot...</option>
            ${vacantLots.map(l => `<option value="${l.id}">${l.id}${l.size_restriction ? ' (' + l.size_restriction + ')' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Monthly Rent ($)</label><input name="monthly_rent" type="number" step="0.01" value="295"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input name="phone"></div>
        <div class="form-group"><label>Check-In Date</label><input name="check_in_date" type="date" value="${new Date().toISOString().split('T')[0]}" required></div>
      </div>
      <div class="form-group"><label>Notes</label><textarea name="notes"></textarea></div>
      <button type="submit" class="btn btn-success btn-full mt-2">Check In</button>
    </form>
  `);
}

async function processCheckIn(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);

  // Create tenant
  const tenant = await API.post('/tenants', {
    lot_id: data.lot_id, first_name: data.first_name, last_name: data.last_name,
    phone: data.phone, monthly_rent: parseFloat(data.monthly_rent), move_in_date: data.check_in_date
  });

  // Create check-in record
  await API.post('/checkins/checkin', {
    tenant_id: tenant.id, lot_id: data.lot_id, check_in_date: data.check_in_date, notes: data.notes
  });

  closeModal();
  loadCheckins();
}

async function showCheckOut() {
  const tenants = await API.get('/tenants');
  showModal('Check-Out Tenant', `
    <form onsubmit="processCheckOut(event)">
      <div class="form-group">
        <label>Select Tenant</label>
        <select name="tenant_select" required onchange="checkoutSelected(this)">
          <option value="">Select tenant...</option>
          ${tenants.map(t => `<option value="${t.id}|${t.lot_id}">${t.lot_id} - ${t.first_name} ${t.last_name}</option>`).join('')}
        </select>
        <input type="hidden" name="tenant_id">
        <input type="hidden" name="lot_id">
      </div>
      <div class="form-group"><label>Check-Out Date</label><input name="check_out_date" type="date" value="${new Date().toISOString().split('T')[0]}" required></div>
      <div class="form-group"><label>Notes</label><textarea name="notes"></textarea></div>
      <button type="submit" class="btn btn-warning btn-full mt-2">Check Out</button>
    </form>
  `);
}

function checkoutSelected(sel) {
  const [tid, lid] = sel.value.split('|');
  sel.form.tenant_id.value = tid;
  sel.form.lot_id.value = lid;
}

async function processCheckOut(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  await API.post('/checkins/checkout', {
    tenant_id: parseInt(form.get('tenant_id')),
    lot_id: form.get('lot_id'),
    check_out_date: form.get('check_out_date'),
    notes: form.get('notes')
  });
  closeModal();
  loadCheckins();
}
