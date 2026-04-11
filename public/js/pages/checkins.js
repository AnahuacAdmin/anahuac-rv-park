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
        <button class="btn btn-outline" onclick="shareCheckInLink()">&#128279; Share App Link</button>
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
      <p id="checkin-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

async function processCheckIn(e) {
  e.preventDefault();
  const errEl = document.getElementById('checkin-error');
  if (errEl) errEl.style.display = 'none';
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);

  if (!data.first_name || !data.last_name) {
    if (errEl) { errEl.textContent = 'First and last name are required.'; errEl.style.display = ''; }
    return;
  }
  if (!data.lot_id) {
    if (errEl) { errEl.textContent = 'Please select a lot.'; errEl.style.display = ''; }
    return;
  }

  let tenant;
  try {
    // Create tenant
    tenant = await API.post('/tenants', {
      lot_id: data.lot_id, first_name: data.first_name, last_name: data.last_name,
      phone: data.phone, monthly_rent: parseFloat(data.monthly_rent), move_in_date: data.check_in_date
    });
    if (!tenant?.id) throw new Error('Tenant was not created — no ID returned');
  } catch (err) {
    const msg = err.message || 'Failed to create tenant';
    if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
    else alert('Check-in failed: ' + msg);
    return;
  }

  try {
    // Create check-in record
    await API.post('/checkins/checkin', {
      tenant_id: tenant.id, lot_id: data.lot_id, check_in_date: data.check_in_date, notes: data.notes
    });
  } catch (err) {
    // Tenant was created but checkin record failed — not fatal, warn and continue.
    console.error('Checkin record failed:', err);
  }

  closeModal();

  // Show success with option to send welcome text.
  const tenantName = `${data.first_name} ${data.last_name}`;
  const phone = data.phone;
  showCelebration('🏕️🎉', 'Welcome to Anahuac RV Park!');
  setTimeout(() => showModal('Check-In Complete', `
    <div style="text-align:center;padding:1rem 0">
      <div style="font-size:2.5rem;margin-bottom:0.5rem">&#9989;</div>
      <h3>${tenantName} checked in to Lot ${data.lot_id}</h3>
      <p style="color:var(--gray-500);margin:0.5rem 0 1.5rem">Tenant record created and lot marked occupied.</p>
      ${phone ? `
        <button class="btn btn-success btn-full" onclick="sendWelcomeText(${tenant.id}, '${tenantName.replace(/'/g, "\\'")}')">
          &#128241; Send Welcome Text to ${phone}
        </button>
        <p style="font-size:0.8rem;color:var(--gray-500);margin-top:0.5rem">Sends a welcome message + park rules via SMS</p>
      ` : '<p style="color:var(--warning)">No phone number on file — cannot send welcome text.</p>'}
      <button class="btn btn-outline btn-full mt-2" onclick="closeModal();loadCheckins()">Done</button>
    </div>
  `), 3200);
}

async function sendWelcomeText(tenantId, tenantName) {
  try {
    const r = await API.post(`/checkins/welcome-sms/${tenantId}`, {});
    if (r?.sent) {
      alert(`Welcome texts sent to ${r.sentTo}!\n\n1) Welcome message with app link\n2) Park rules summary`);
    } else {
      alert('SMS not sent: ' + (r?.reason || 'unknown'));
    }
  } catch (err) {
    alert('Failed to send welcome text: ' + (err.message || 'unknown'));
  }
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
      <p id="checkout-error" class="error-text" style="display:none"></p>
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
  const errEl = document.getElementById('checkout-error');
  if (errEl) errEl.style.display = 'none';
  try {
    await API.post('/checkins/checkout', {
      tenant_id: parseInt(form.get('tenant_id')),
      lot_id: form.get('lot_id'),
      check_out_date: form.get('check_out_date'),
      notes: form.get('notes')
    });
    closeModal();
    loadCheckins();
  } catch (err) {
    const msg = err.message || 'Check-out failed';
    if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
    else alert('Check-out failed: ' + msg);
  }
}

function shareCheckInLink() {
  navigator.clipboard.writeText(APP_URL).then(() => {
    showStatusToast('✅', 'Link copied to clipboard!');
    const t = document.querySelector('.status-toast.visible');
    if (t) setTimeout(() => t.classList.remove('visible'), 2500);
  }).catch(() => {
    prompt('Copy this link:', APP_URL);
  });
}
