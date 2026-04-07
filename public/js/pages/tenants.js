function recurringSummary(t) {
  const parts = [];
  if (t.recurring_late_fee) parts.push(`Late ${formatMoney(t.recurring_late_fee)}`);
  if (t.recurring_mailbox_fee) parts.push(`Mailbox ${formatMoney(t.recurring_mailbox_fee)}`);
  if (t.recurring_misc_fee) parts.push(`${t.recurring_misc_description || 'Misc'} ${formatMoney(t.recurring_misc_fee)}`);
  if (t.recurring_credit) parts.push(`-${formatMoney(t.recurring_credit)} ${t.recurring_credit_description || 'credit'}`);
  return parts.length ? `<small>${parts.join('<br>')}</small>` : '<small style="color:#999">—</small>';
}

async function loadTenants() {
  const tenants = await API.get('/tenants');
  if (!tenants) return;

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('tenants')}
    <div class="page-header">
      <h2>Tenant Management</h2>
      <button class="btn btn-primary" onclick="showAddTenant()">+ Add Tenant</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>Lot</th><th>Name</th><th>Rent</th><th>Type</th><th>Recurring Fees</th><th>Move-In</th><th>Actions</th></tr></thead>
          <tbody>
            ${tenants.map(t => `
              <tr>
                <td><strong>${t.lot_id}</strong></td>
                <td>${t.first_name} ${t.last_name}</td>
                <td>${formatMoney(t.monthly_rent)}</td>
                <td><span class="badge badge-${t.rent_type === 'premium' ? 'warning' : t.rent_type === 'electric_only' ? 'info' : 'gray'}">${t.rent_type}</span></td>
                <td>${recurringSummary(t)}</td>
                <td>${formatDate(t.move_in_date)}</td>
                <td class="btn-group">
                  <button class="btn btn-sm btn-outline" onclick="showEditTenant(${t.id})">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="removeTenant(${t.id}, '${t.first_name} ${t.last_name}')">Remove</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function showAddTenant() {
  const lots = await API.get('/lots');
  const vacantLots = lots.filter(l => l.status === 'vacant');
  showModal('Add New Tenant', tenantForm(vacantLots));
}

async function showEditTenant(id) {
  const tenant = await API.get(`/tenants/${id}`);
  if (!tenant) return;
  const lots = await API.get('/lots');
  const availableLots = lots.filter(l => l.status === 'vacant' || l.id === tenant.lot_id);
  showModal('Edit Tenant', tenantForm(availableLots, tenant));
}

function tenantForm(lots, tenant = {}) {
  return `
    <form onsubmit="saveTenant(event, ${tenant.id || 'null'})">
      <div class="form-row">
        <div class="form-group">
          <label>First Name</label>
          <input name="first_name" value="${tenant.first_name || ''}" required>
        </div>
        <div class="form-group">
          <label>Last Name</label>
          <input name="last_name" value="${tenant.last_name || ''}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Lot</label>
          <select name="lot_id" required>
            <option value="">Select lot...</option>
            ${lots.map(l => `<option value="${l.id}" ${tenant.lot_id === l.id ? 'selected' : ''}>${l.id}${l.size_restriction ? ' (' + l.size_restriction + ')' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Monthly Rent ($)</label>
          <input name="monthly_rent" type="number" step="0.01" value="${tenant.monthly_rent ?? 295}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Rent Type</label>
          <select name="rent_type">
            <option value="standard" ${tenant.rent_type === 'standard' ? 'selected' : ''}>Standard</option>
            <option value="premium" ${tenant.rent_type === 'premium' ? 'selected' : ''}>Premium</option>
            <option value="prorated" ${tenant.rent_type === 'prorated' ? 'selected' : ''}>Prorated</option>
            <option value="electric_only" ${tenant.rent_type === 'electric_only' ? 'selected' : ''}>Electric Only</option>
          </select>
        </div>
        <div class="form-group">
          <label>Move-In Date</label>
          <input name="move_in_date" type="date" value="${tenant.move_in_date || new Date().toISOString().split('T')[0]}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input name="phone" value="${tenant.phone || ''}"></div>
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${tenant.email || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Emergency Contact</label><input name="emergency_contact" value="${tenant.emergency_contact || ''}"></div>
        <div class="form-group"><label>Emergency Phone</label><input name="emergency_phone" value="${tenant.emergency_phone || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>RV Make</label><input name="rv_make" value="${tenant.rv_make || ''}"></div>
        <div class="form-group"><label>RV Model</label><input name="rv_model" value="${tenant.rv_model || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>RV Year</label><input name="rv_year" value="${tenant.rv_year || ''}"></div>
        <div class="form-group"><label>RV Length</label><input name="rv_length" value="${tenant.rv_length || ''}"></div>
      </div>
      <div class="form-group"><label>License Plate</label><input name="license_plate" value="${tenant.license_plate || ''}"></div>

      <fieldset style="border:1px solid #ddd;padding:0.75rem;margin:0.75rem 0;border-radius:6px">
        <legend><strong>Recurring Monthly Fees</strong></legend>
        <p><small>Automatically applied each time monthly invoices are generated.</small></p>
        <div class="form-row">
          <div class="form-group"><label>Recurring Late Fee</label><input name="recurring_late_fee" type="number" step="0.01" value="${tenant.recurring_late_fee || 0}"></div>
          <div class="form-group"><label>Recurring Mailbox Fee</label><input name="recurring_mailbox_fee" type="number" step="0.01" value="${tenant.recurring_mailbox_fee || 0}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Recurring Misc Fee</label><input name="recurring_misc_fee" type="number" step="0.01" value="${tenant.recurring_misc_fee || 0}"></div>
          <div class="form-group"><label>Misc Description</label><input name="recurring_misc_description" value="${tenant.recurring_misc_description || ''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Recurring Credit / Discount</label><input name="recurring_credit" type="number" step="0.01" value="${tenant.recurring_credit || 0}"></div>
          <div class="form-group"><label>Credit Description</label><input name="recurring_credit_description" value="${tenant.recurring_credit_description || ''}"></div>
        </div>
      </fieldset>

      <div class="form-group"><label>Notes</label><textarea name="notes">${tenant.notes || ''}</textarea></div>
      <button type="submit" class="btn btn-primary btn-full mt-2">${tenant.id ? 'Update' : 'Add'} Tenant</button>
    </form>
  `;
}

async function saveTenant(e, id) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);
  data.monthly_rent = parseFloat(data.monthly_rent) || 0;
  ['recurring_late_fee','recurring_mailbox_fee','recurring_misc_fee','recurring_credit']
    .forEach(k => data[k] = parseFloat(data[k]) || 0);

  if (id) {
    await API.put(`/tenants/${id}`, data);
  } else {
    await API.post('/tenants', data);
  }
  closeModal();
  loadTenants();
}

async function removeTenant(id, name) {
  if (!confirm(`Remove tenant ${name}? This will mark them as inactive and free the lot.`)) return;
  await API.del(`/tenants/${id}`);
  loadTenants();
}
