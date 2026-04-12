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
      <div class="btn-group">
        <button class="btn btn-outline" onclick="showRecurringFeesSummary()">Recurring Fees Summary</button>
      </div>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>Lot</th><th>Name</th><th>Rent</th><th>Type</th><th>Recurring Fees</th><th>Move-In</th><th>Actions</th></tr></thead>
          <tbody>
            ${tenants.map(t => `
              <tr>
                <td><strong>${t.lot_id}</strong></td>
                <td>${t.first_name} ${t.last_name}${(t.eviction_warning === 1 && t.balance_due > 0) ? ' <span class="badge badge-danger" title="Eviction warning">EVICTION</span>' : ''}${t.credit_balance > 0 ? ` <span class="badge badge-success" title="Account credit">Credit: ${formatMoney(t.credit_balance)}</span>` : ''}</td>
                <td>${formatMoney(t.monthly_rent)}</td>
                <td><span class="badge badge-${t.rent_type === 'daily' ? 'info' : t.rent_type === 'weekly' ? 'info' : t.rent_type === 'premium' ? 'warning' : t.rent_type === 'electric_only' ? 'info' : 'gray'}">${t.rent_type}</span></td>
                <td>${recurringSummary(t)}</td>
                <td>${formatDate(t.move_in_date)}</td>
                <td class="btn-group">
                  <button class="btn btn-sm btn-outline" onclick="showEditTenant(${t.id})">Edit</button>
                  <button class="btn btn-sm btn-outline" onclick="showTenantHistory(${t.id}, '${(t.first_name + ' ' + t.last_name).replace(/'/g, "\\'")}')">History</button>
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
          <label>Rate Type</label>
          <select name="rent_type">
            <option value="monthly" ${tenant.rent_type === 'monthly' || tenant.rent_type === 'standard' ? 'selected' : ''}>Monthly</option>
            <option value="weekly" ${tenant.rent_type === 'weekly' ? 'selected' : ''}>Weekly</option>
            <option value="daily" ${tenant.rent_type === 'daily' ? 'selected' : ''}>Daily</option>
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
      ${tenant.id ? `
        <div class="form-group">
          <button type="button" class="btn btn-warning" onclick="showMoveTenant(${tenant.id}, '${tenant.lot_id}', \`${(tenant.first_name + ' ' + tenant.last_name).replace(/`/g, '')}\`)">Move to Different Lot</button>
        </div>
      ` : ''}

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

      <fieldset style="border:1px solid #ddd;padding:0.75rem;margin:0.75rem 0;border-radius:6px">
        <legend><strong>Communication Preferences</strong></legend>
        <div class="form-row">
          <div class="form-group">
            <label>Invoice Delivery</label>
            <select name="invoice_delivery">
              <option value="both" ${(tenant.invoice_delivery || 'both') === 'both' ? 'selected' : ''}>Email + SMS</option>
              <option value="email" ${tenant.invoice_delivery === 'email' ? 'selected' : ''}>Email Only</option>
              <option value="sms" ${tenant.invoice_delivery === 'sms' ? 'selected' : ''}>SMS Only</option>
              <option value="print" ${tenant.invoice_delivery === 'print' ? 'selected' : ''}>Print / Manual</option>
            </select>
          </div>
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:0.5rem;margin-top:1.5rem">
              <input type="checkbox" name="sms_opt_in" value="1" ${tenant.sms_opt_in !== 0 ? 'checked' : ''}> SMS Notifications
            </label>
            <label style="display:flex;align-items:center;gap:0.5rem;margin-top:0.25rem">
              <input type="checkbox" name="email_opt_in" value="1" ${tenant.email_opt_in !== 0 ? 'checked' : ''}> Email Notifications
            </label>
          </div>
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
  data.sms_opt_in = data.sms_opt_in === '1' ? 1 : 0;
  data.email_opt_in = data.email_opt_in === '1' ? 1 : 0;
  data.invoice_delivery = data.invoice_delivery || 'both';

  if (id) {
    await API.put(`/tenants/${id}`, data);
  } else {
    await API.post('/tenants', data);
  }
  closeModal();
  loadTenants();
}

async function showMoveTenant(tenantId, currentLot, tenantName) {
  const lots = await API.get('/lots');
  const vacantLots = (lots || []).filter(l => l.status === 'vacant');
  if (!vacantLots.length) {
    alert('There are no vacant lots available to move this tenant to.');
    return;
  }
  showModal(`Move ${tenantName}`, `
    <p>Currently on lot <strong>${currentLot || '(none)'}</strong>.</p>
    <form onsubmit="submitMoveTenant(event, ${tenantId})">
      <div class="form-row">
        <div class="form-group">
          <label>New Lot</label>
          <select name="new_lot_id" required>
            <option value="">Select a vacant lot...</option>
            ${vacantLots.map(l => `<option value="${l.id}">${l.id}${l.size_restriction ? ' (' + l.size_restriction + ')' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Move Date</label>
          <input name="move_date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Old Lot Final Meter Reading</label>
          <input name="old_meter_reading" type="number" step="0.01" placeholder="e.g. 57884">
        </div>
        <div class="form-group">
          <label>New Lot Opening Meter Reading</label>
          <input name="new_meter_reading" type="number" step="0.01" placeholder="e.g. 21000">
        </div>
      </div>
      <div class="form-group">
        <label>Mid-Month Move Notes</label>
        <textarea name="mid_month_move_notes" placeholder="Reason for move, condition of lots, special arrangements..."></textarea>
      </div>
      <p><small>This will: move the tenant, mark <strong>${currentLot}</strong> vacant, mark the new lot occupied, record the final electric reading on the old lot and the opening reading on the new lot. Rent for the next monthly invoice will be prorated by days at each lot.</small></p>
      <button type="submit" class="btn btn-primary btn-full mt-2">Move Tenant</button>
      <p id="move-tenant-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

async function submitMoveTenant(e, tenantId) {
  e.preventDefault();
  const errEl = document.getElementById('move-tenant-error');
  if (errEl) errEl.style.display = 'none';
  const form = new FormData(e.target);
  const new_lot_id = form.get('new_lot_id');
  if (!new_lot_id) return;
  try {
    const result = await API.post(`/tenants/${tenantId}/move`, {
      new_lot_id,
      move_date: form.get('move_date') || undefined,
      old_meter_reading: form.get('old_meter_reading') || undefined,
      new_meter_reading: form.get('new_meter_reading') || undefined,
      mid_month_move_notes: form.get('mid_month_move_notes') || undefined,
    });
    closeModal();
    alert(`${result.tenant} moved from ${result.from || '(none)'} to ${result.to}.`);
    loadTenants();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || 'Failed to move tenant';
      errEl.style.display = '';
    } else {
      alert('Failed to move tenant: ' + (err.message || 'unknown error'));
    }
  }
}

async function showTenantHistory(tenantId, name) {
  const [checkins, payments] = await Promise.all([
    API.get('/checkins'),
    API.get(`/payments/tenant/${tenantId}`)
  ]);
  const tenantCheckins = (checkins || []).filter(c => c.tenant_id === tenantId);
  const tenantPayments = payments || [];
  showModal(`History — ${name}`, `
    <h4>Check-In/Out History</h4>
    ${tenantCheckins.length ? `<table><thead><tr><th>Lot</th><th>Check-In</th><th>Check-Out</th><th>Status</th></tr></thead><tbody>
      ${tenantCheckins.map(c => `<tr><td>${c.lot_name || c.lot_id}</td><td>${formatDate(c.check_in_date)}</td><td>${c.check_out_date ? formatDate(c.check_out_date) : '—'}</td><td><span class="badge badge-${c.status === 'checked_in' ? 'success' : 'gray'}">${c.status}</span></td></tr>`).join('')}
    </tbody></table>` : '<p>No check-in records.</p>'}
    <h4 class="mt-2">Payment History</h4>
    ${tenantPayments.length ? `<table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Invoice</th></tr></thead><tbody>
      ${tenantPayments.map(p => `<tr><td>${formatDate(p.payment_date)}</td><td>${formatMoney(p.amount)}</td><td>${p.payment_method || '—'}</td><td>${p.invoice_number || '—'}</td></tr>`).join('')}
    </tbody></table>` : '<p>No payments recorded.</p>'}
  `);
}

async function showRecurringFeesSummary() {
  const tenants = await API.get('/tenants');
  if (!tenants) return;
  const num = (v) => Number(v) || 0;
  const withFees = tenants
    .filter(t => num(t.recurring_late_fee) || num(t.recurring_mailbox_fee) || num(t.recurring_misc_fee) || num(t.recurring_credit))
    .sort((a, b) => (a.lot_id || '').localeCompare(b.lot_id || ''));

  const totals = withFees.reduce((acc, t) => {
    acc.late    += num(t.recurring_late_fee);
    acc.mailbox += num(t.recurring_mailbox_fee);
    acc.misc    += num(t.recurring_misc_fee);
    acc.credit  += num(t.recurring_credit);
    return acc;
  }, { late: 0, mailbox: 0, misc: 0, credit: 0 });
  const grand = totals.late + totals.mailbox + totals.misc - totals.credit;

  const body = withFees.length ? `
    <div class="table-container">
      <table>
        <thead><tr><th>Lot</th><th>Tenant</th><th class="text-right">Late</th><th class="text-right">Mailbox</th><th class="text-right">Misc</th><th class="text-right">Credit</th><th class="text-right">Net / month</th></tr></thead>
        <tbody>
          ${withFees.map(t => {
            const net = num(t.recurring_late_fee) + num(t.recurring_mailbox_fee) + num(t.recurring_misc_fee) - num(t.recurring_credit);
            return `
              <tr>
                <td><strong>${t.lot_id}</strong></td>
                <td>${t.first_name} ${t.last_name}</td>
                <td class="text-right">${formatMoney(t.recurring_late_fee)}</td>
                <td class="text-right">${formatMoney(t.recurring_mailbox_fee)}</td>
                <td class="text-right">${formatMoney(t.recurring_misc_fee)}${t.recurring_misc_description ? ` <small>(${t.recurring_misc_description})</small>` : ''}</td>
                <td class="text-right">${t.recurring_credit ? '-' + formatMoney(t.recurring_credit) : formatMoney(0)}${t.recurring_credit_description ? ` <small>(${t.recurring_credit_description})</small>` : ''}</td>
                <td class="text-right"><strong>${formatMoney(net)}</strong></td>
              </tr>
            `;
          }).join('')}
          <tr class="total-row" style="border-top:2px solid #111">
            <td colspan="2"><strong>TOTAL (${withFees.length} tenants)</strong></td>
            <td class="text-right"><strong>${formatMoney(totals.late)}</strong></td>
            <td class="text-right"><strong>${formatMoney(totals.mailbox)}</strong></td>
            <td class="text-right"><strong>${formatMoney(totals.misc)}</strong></td>
            <td class="text-right"><strong>-${formatMoney(totals.credit)}</strong></td>
            <td class="text-right"><strong>${formatMoney(grand)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="mt-2"><small>These charges auto-apply each time you click <em>Generate Monthly Invoices</em>. Edit any tenant to change their recurring fees.</small></p>
  ` : `<p>No tenants have recurring fees configured. Open any tenant's <em>Edit</em> form and use the <strong>Recurring Monthly Fees</strong> section to add some.</p>`;

  showModal('Recurring Fees Summary', body);
}

async function removeTenant(id, name) {
  if (!confirm(`Remove tenant ${name}? This will mark them as inactive and free the lot.`)) return;
  await API.del(`/tenants/${id}`);
  loadTenants();
}
