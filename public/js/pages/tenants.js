/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
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
      <h2>Guest Management</h2>
      <div class="btn-group">
        ${API.user?.role === 'admin' ? '<button class="btn btn-outline" onclick="showImportTenants()">📥 Import Tenants</button>' : ''}
        <button class="btn btn-outline" onclick="showRecurringFeesSummary()">Recurring Fees Summary</button>
      </div>
    </div>
    ${API.user?.role === 'admin' ? importHelpPanelHtml() : ''}
    <div class="card scrollable-table-card">
      <div class="table-container">
        <table>
          <thead><tr><th>Lot</th><th>Name</th><th>Rent</th><th>Type</th><th>Recurring Fees</th><th>Move-In</th><th>Actions</th></tr></thead>
          <tbody>
            ${tenants.map(t => `
              <tr style="${t.balance_due > 0 ? 'background:#fff0f0' : ''}">
                <td><strong>${t.lot_id}</strong></td>
                <td>${t.first_name} ${t.last_name}${t.credit_balance > 0 ? ` <span class="badge badge-success" title="Account credit">Credit: ${formatMoney(t.credit_balance)}</span>` : ''}</td>
                <td>${formatMoney(t.monthly_rent)}</td>
                <td><span class="badge badge-${t.rent_type === 'daily' ? 'info' : t.rent_type === 'weekly' ? 'info' : t.rent_type === 'premium' ? 'warning' : t.rent_type === 'electric_only' ? 'info' : 'gray'}">${t.rent_type}</span>${t.flat_rate ? '<span class="badge badge-success" style="margin-left:4px">FLAT</span>' : ''}${t.deposit_waived ? '<span class="badge badge-gray" style="margin-left:4px;font-size:0.6rem">DEP WAIVED</span>' : ''}</td>
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
  showModal('Add New Guest', tenantForm(vacantLots));
}

async function showEditTenant(id) {
  const tenant = await API.get(`/tenants/${id}`);
  if (!tenant) return;
  const lots = await API.get('/lots');
  const availableLots = lots.filter(l => l.status === 'vacant' || l.id === tenant.lot_id);
  showModal('Edit Guest', tenantForm(availableLots, tenant));
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
      <div class="form-row">
        <div class="form-group"><label>ID / Driver's License #</label><input name="id_number" value="${tenant.id_number || ''}"></div>
        <div class="form-group"><label>Date of Birth</label><input name="date_of_birth" type="date" value="${tenant.date_of_birth || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Deposit Paid ($)</label><input name="deposit_amount" type="number" step="0.01" value="${tenant.deposit_amount || 0}" ${tenant.deposit_waived ? 'disabled' : ''}></div>
        <div class="form-group" style="display:flex;align-items:flex-end">
          <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem">
            <input type="checkbox" name="deposit_waived" value="1" ${tenant.deposit_waived ? 'checked' : ''} onchange="var d=this.form.deposit_amount;d.disabled=this.checked;if(this.checked)d.value='0'"> Waive Deposit
          </label>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Insurance Expiry</label><input name="insurance_expiry" type="date" value="${tenant.insurance_expiry || ''}"></div>
        <div class="form-group"><label>Registration Expiry</label><input name="registration_expiry" type="date" value="${tenant.registration_expiry || ''}"></div>
      </div>
      <p style="font-size:0.72rem;color:var(--gray-400);margin:-0.25rem 0 0.5rem">📅 Set expiry dates for automatic SMS reminders at 30 and 7 days before expiry.</p>
      <label style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;font-size:0.85rem;cursor:pointer">
        <input type="checkbox" name="loyalty_exclude" value="1" ${tenant.loyalty_exclude ? 'checked' : ''}> Exclude from loyalty discount program
      </label>

      ${tenant.id ? `
        <div class="form-group" style="display:flex;flex-wrap:wrap;gap:0.5rem">
          <button type="button" class="btn btn-warning" onclick="showMoveTenant(${tenant.id}, '${tenant.lot_id}', \`${(tenant.first_name + ' ' + tenant.last_name).replace(/`/g, '')}\`)">Move to Different Lot</button>
          <button type="button" class="btn btn-outline" style="color:#d97706;border-color:#d97706" onclick="resetTenantPin(${tenant.id}, \`${(tenant.first_name + ' ' + tenant.last_name).replace(/`/g, '')}\`)">🔑 Reset PIN</button>
          <button type="button" class="btn btn-outline" style="color:#f59e0b;border-color:#f59e0b" onclick="promptTenantReview(${tenant.id}, \`${(tenant.first_name + ' ' + tenant.last_name).replace(/`/g, '')}\`)">⭐ Request Review</button>
          <button type="button" class="btn btn-outline" onclick="showApplicationPicker({first_name:'${(tenant.first_name||'').replace(/'/g,"\\'")}',last_name:'${(tenant.last_name||'').replace(/'/g,"\\'")}',phone:'${tenant.phone||''}',email:'${tenant.email||''}',lot_id:'${tenant.lot_id||''}',id_number:'${tenant.id_number||''}',date_of_birth:'${tenant.date_of_birth||''}',rv_year:'${tenant.rv_year||''}',rv_make:'${(tenant.rv_make||'').replace(/'/g,"\\'")}',rv_model:'${(tenant.rv_model||'').replace(/'/g,"\\'")}',license_plate:'${tenant.license_plate||''}',license_plate_state:'${tenant.license_plate_state||''}',emergency_contact:'${(tenant.emergency_contact||'').replace(/'/g,"\\'")}',emergency_phone:'${tenant.emergency_phone||''}'})">&#128203; Print Application</button>
          ${!tenant.is_active ? `<button type="button" class="btn btn-outline" style="color:#6366f1;border-color:#6366f1" onclick="viewMoveOutStatement(${tenant.id})">📄 Move-Out Statement</button>` : ''}
        </div>
        ${tenant.last_move_old_lot_id ? `
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:0.6rem;margin:0.5rem 0;font-size:0.85rem">
          <strong>&#128205; Lot History:</strong>
          Lot ${tenant.last_move_old_lot_id} (${tenant.move_in_date ? formatDate(tenant.move_in_date) : '?'} – ${tenant.last_move_date ? formatDate(tenant.last_move_date) : '?'})
          &rarr; Lot ${tenant.lot_id} (${tenant.last_move_date ? formatDate(tenant.last_move_date) : '?'} – present)
          ${tenant.mid_month_move_notes ? '<br><span style="color:var(--gray-500);font-size:0.8rem">' + tenant.mid_month_move_notes.replace(/</g,'&lt;') + '</span>' : ''}
        </div>` : ''}
      ` : ''}

      ${tenant.id ? `
      <fieldset style="border:2px solid ${Number(tenant.credit_balance) > 0 ? '#16a34a' : Number(tenant.balance_due) > 0 ? '#dc2626' : '#d1d5db'};padding:0.75rem;margin:0.75rem 0;border-radius:8px">
        <legend><strong>Account Balance</strong></legend>
        <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap">
          <div>
            <div style="font-size:0.8rem;color:var(--gray-500)">Outstanding Balance</div>
            <div style="font-size:1.2rem;font-weight:700;color:${Number(tenant.balance_due) > 0 ? '#dc2626' : '#16a34a'}">${Number(tenant.balance_due) > 0 ? formatMoney(tenant.balance_due) + ' owed' : '$0.00 — paid up'}</div>
          </div>
          <div>
            <div style="font-size:0.8rem;color:var(--gray-500)">Credit on File</div>
            <div style="font-size:1.2rem;font-weight:700;color:${Number(tenant.credit_balance) > 0 ? '#16a34a' : 'var(--gray-400)'}">
              ${Number(tenant.credit_balance) > 0 ? formatMoney(tenant.credit_balance) + ' credit' : '$0.00'}
            </div>
          </div>
        </div>
        ${Number(tenant.credit_balance) > 0 ? `
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.75rem">
          <button type="button" class="btn btn-sm btn-outline" style="color:#16a34a;border-color:#16a34a" onclick="showApplyCredit(${tenant.id}, ${tenant.credit_balance}, \`${(tenant.first_name + ' ' + tenant.last_name).replace(/`/g, '')}\`)">Apply to Invoice</button>
          <button type="button" class="btn btn-sm btn-outline" style="color:#dc2626;border-color:#dc2626" onclick="showRefundCredit(${tenant.id}, ${tenant.credit_balance}, \`${(tenant.first_name + ' ' + tenant.last_name).replace(/`/g, '')}\`)">Refund</button>
          <button type="button" class="btn btn-sm btn-outline" style="color:#0284c7;border-color:#0284c7" onclick="showTransferCredit(${tenant.id}, ${tenant.credit_balance}, \`${(tenant.first_name + ' ' + tenant.last_name).replace(/`/g, '')}\`, '${tenant.lot_id}')">Transfer to Another Guest</button>
        </div>
        ` : ''}
        <div style="margin-top:0.75rem">
          <button type="button" class="btn btn-sm btn-outline" onclick="showCreditHistory(${tenant.id}, \`${(tenant.first_name + ' ' + tenant.last_name).replace(/`/g, '')}\`)">View Credit History</button>
        </div>
      </fieldset>
      ` : ''}

      <fieldset style="border:1px solid #16a34a;padding:0.75rem;margin:0.75rem 0;border-radius:6px">
        <legend><strong style="color:#16a34a">Flat Rate Billing</strong></legend>
        <p><small>When enabled, one fixed monthly amount covers rent + electric + all fees. No separate electric charge.</small></p>
        <div class="form-row mt-1">
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:0.5rem">
              <input type="checkbox" name="flat_rate" value="1" ${tenant.flat_rate ? 'checked' : ''} onchange="toggleFlatRate(this)"> Enable Flat Rate
            </label>
          </div>
          <div class="form-group" id="flat-rate-amount-group" style="${tenant.flat_rate ? '' : 'display:none'}">
            <label>Flat Rate Amount ($/month)</label>
            <input name="flat_rate_amount" type="number" step="0.01" value="${tenant.flat_rate_amount || 0}">
          </div>
        </div>
      </fieldset>

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
      <button type="submit" class="btn btn-primary btn-full mt-2">${tenant.id ? 'Update' : 'Add'} Guest</button>
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
  data.deposit_amount = parseFloat(data.deposit_amount) || 0;
  data.deposit_waived = data.deposit_waived === '1' ? 1 : 0;
  data.loyalty_exclude = data.loyalty_exclude === '1' ? 1 : 0;
  data.flat_rate = data.flat_rate === '1' ? 1 : 0;
  data.flat_rate_amount = parseFloat(data.flat_rate_amount) || 0;

  if (id) {
    await API.put(`/tenants/${id}`, data);
  } else {
    await API.post('/tenants', data);
  }
  closeModal();
  loadTenants();
}

async function showMoveTenant(tenantId, currentLot, tenantName) {
  const [lots, meterData] = await Promise.all([
    API.get('/lots'),
    currentLot ? API.get('/meters/lot/' + currentLot).catch(() => []) : Promise.resolve([])
  ]);
  const vacantLots = (lots || []).filter(l => l.status === 'vacant');
  if (!vacantLots.length) {
    alert('There are no vacant lots available to move this guest to.');
    return;
  }
  // Find the most recent reading for this tenant on this lot
  var prevReading = (meterData || []).find(r => r.tenant_id === tenantId);
  var prevValue = prevReading ? Number(prevReading.current_reading) : 0;
  var prevDate = prevReading ? prevReading.reading_date : '—';

  showModal(`Move ${tenantName} to Different Lot`, `
    <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:0.75rem;margin-bottom:1rem">
      <strong>Current Lot:</strong> ${currentLot || '(none)'}
      ${prevReading ? `<br><strong>Last Meter Reading:</strong> ${prevValue.toLocaleString()} kWh on ${formatDate(prevDate)}` : '<br><span style="color:#dc2626">No previous meter reading found</span>'}
    </div>
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

      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:0.75rem;margin:0.75rem 0">
        <p style="font-weight:700;margin-bottom:0.5rem;font-size:0.9rem">&#9889; Electric Meter Handoff</p>
        <div class="form-row">
          <div class="form-group">
            <label>Final Reading — ${currentLot} (old lot)</label>
            <input name="old_meter_reading" id="move-old-meter" type="number" step="1" required placeholder="Enter meter face value" oninput="calcMoveElectric()">
            ${prevReading ? `<span style="font-size:0.75rem;color:var(--gray-500)">Previous: ${prevValue.toLocaleString()}</span>` : ''}
            <input type="hidden" id="move-prev-value" value="${prevValue}">
          </div>
          <div class="form-group">
            <label>Opening Reading — new lot</label>
            <input name="new_meter_reading" id="move-new-meter" type="number" step="1" required placeholder="Enter meter face value">
          </div>
        </div>
        <div id="move-electric-calc" style="display:none;margin-top:0.5rem;padding:0.5rem;background:#fff;border-radius:6px;font-size:0.88rem"></div>
      </div>

      <div class="form-group">
        <label>Reason for Move <span style="font-weight:400;color:var(--gray-400)">(optional)</span></label>
        <textarea name="mid_month_move_notes" placeholder="Maintenance, flooding, preference, RV size change..."></textarea>
      </div>

      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:0.75rem;margin:0.75rem 0;font-size:0.82rem;color:#166534">
        <strong>What happens:</strong>
        <ul style="margin:0.25rem 0 0 1.25rem;padding:0">
          <li>${currentLot} marked vacant, new lot marked occupied</li>
          <li>Final electric reading recorded on ${currentLot}</li>
          <li>Electric carry-over charge added to next invoice</li>
          <li>Opening meter reading set on new lot</li>
          <li>Rent prorated by days at each lot on next invoice</li>
          <li>All billing history, payments, credits stay intact</li>
        </ul>
      </div>

      <button type="submit" class="btn btn-primary btn-full mt-2">Move Guest</button>
      <p id="move-tenant-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

function calcMoveElectric() {
  var finalEl = document.getElementById('move-old-meter');
  var prevEl = document.getElementById('move-prev-value');
  var calcDiv = document.getElementById('move-electric-calc');
  if (!finalEl || !prevEl || !calcDiv) return;
  var final = parseFloat(finalEl.value) || 0;
  var prev = parseFloat(prevEl.value) || 0;
  if (final <= 0) { calcDiv.style.display = 'none'; return; }
  var kwh = Math.max(0, final - prev);
  var charge = +(kwh * 0.15).toFixed(2);
  calcDiv.style.display = '';
  if (final < prev) {
    calcDiv.innerHTML = '<span style="color:#dc2626">&#9888; Final reading is less than previous reading. Please verify.</span>';
  } else {
    calcDiv.innerHTML = '<strong>Usage:</strong> ' + kwh.toLocaleString() + ' kWh &times; $0.15 = <strong style="color:#166534">$' + charge.toFixed(2) + '</strong>' +
      '<br><span style="font-size:0.78rem;color:var(--gray-500)">This will be included as electric on the next invoice.</span>';
  }
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
    var msg = `${result.tenant} moved from ${result.from || '(none)'} to ${result.to}`;
    if (result.electric_kwh > 0) {
      msg += `\n\nElectric carry-over from ${result.from}: ${result.electric_kwh} kWh = $${result.electric_charge.toFixed(2)}`;
      msg += '\nThis will appear on the next invoice.';
    }
    showStatusToast('✅', `${result.tenant} moved to Lot ${result.to}`);
    setTimeout(() => alert(msg), 500);
    loadTenants();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || 'Failed to move guest';
      errEl.style.display = '';
    } else {
      alert('Failed to move guest: ' + (err.message || 'unknown error'));
    }
  }
}

async function resetTenantPin(id, name) {
  if (!confirm('Reset portal PIN for ' + (name || 'this tenant') + '? They will need to create a new PIN next time they log into the portal.')) return;
  try {
    await API.post(`/tenants/${id}/reset-pin`, {});
    showStatusToast('✅', 'PIN reset. ' + (name || 'Tenant') + ' will set a new PIN on their next portal login.');
  } catch (err) { alert('Failed: ' + (err.message || 'unknown')); }
}

async function viewMoveOutStatement(tenantId) {
  try {
    var s = await API.get('/checkins/statement/' + tenantId);
    var html = renderMoveOutStatementHtml(s);
    showModal('Move-Out Statement', '<div id="move-out-statement-view">' + html + '</div>' +
      '<div style="text-align:center;margin-top:1rem"><button class="btn btn-primary" onclick="var w=window.open(\'\',\'_blank\');w.document.write(\'<html><head><title>Move-Out Statement</title></head><body>\'+document.getElementById(\\\'move-out-statement-view\\\').innerHTML+\'</body></html>\');w.document.close();w.print()">🖨️ Print Statement</button></div>');
  } catch (err) {
    showModal('Move-Out Statement', '<div style="text-align:center;padding:2rem;color:#6b7280"><p style="font-size:2rem;margin-bottom:1rem">📄</p><p>Statement not available — generated before this feature was added.</p></div>');
  }
}

async function showTenantHistory(tenantId, name) {
  const [checkins, payments, docs] = await Promise.all([
    API.get('/checkins'),
    API.get(`/payments/tenant/${tenantId}`),
    API.get('/documents/tenant/' + tenantId).catch(function() { return []; }),
  ]);
  const tenantCheckins = (checkins || []).filter(c => c.tenant_id === tenantId);
  const tenantPayments = payments || [];
  const tenantDocs = docs || [];
  showModal(`History — ${name}`, `
    <h4>Check-In/Out History</h4>
    ${tenantCheckins.length ? `<table><thead><tr><th>Lot</th><th>Check-In</th><th>Check-Out</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${tenantCheckins.map(c => `<tr><td>${c.lot_name || c.lot_id}</td><td>${formatDate(c.check_in_date)}</td><td>${c.check_out_date ? formatDate(c.check_out_date) : '—'}</td><td><span class="badge badge-${c.status === 'checked_in' ? 'success' : 'gray'}">${c.status}</span></td><td style="font-size:0.75rem;max-width:200px;white-space:pre-wrap">${c.notes ? escapeHtml(c.notes) : '—'}</td></tr>`).join('')}
    </tbody></table>` : '<p>No check-in records.</p>'}
    <h4 class="mt-2">Payment History</h4>
    ${tenantPayments.length ? `<table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Invoice</th></tr></thead><tbody>
      ${tenantPayments.map(p => `<tr><td>${formatDate(p.payment_date)}</td><td>${formatMoney(p.amount)}</td><td>${p.payment_method || '—'}</td><td>${p.invoice_number || '—'}</td></tr>`).join('')}
    </tbody></table>` : '<p>No payments recorded.</p>'}
    <h4 class="mt-2">📄 Documents</h4>
    ${tenantDocs.length ? `<table><thead><tr><th>Type</th><th>Name</th><th>Date</th><th></th></tr></thead><tbody>
      ${tenantDocs.map(d => `<tr><td style="font-size:0.78rem">${escapeHtml(d.doc_type || 'other')}</td><td>${escapeHtml(d.doc_name)}</td><td style="font-size:0.75rem">${d.uploaded_at || '—'}</td><td><a href="/api/documents/${d.id}/download" target="_blank" class="btn btn-sm btn-outline" style="font-size:0.7rem">👁️</a></td></tr>`).join('')}
    </tbody></table>` : '<p style="color:#78716c">No documents on file. <a href="#" onclick="event.preventDefault();closeModal();navigateTo(\'documents\')">Upload one →</a></p>'}
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
        <thead><tr><th>Lot</th><th>Guest</th><th class="text-right">Late</th><th class="text-right">Mailbox</th><th class="text-right">Misc</th><th class="text-right">Credit</th><th class="text-right">Net / month</th></tr></thead>
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

function toggleFlatRate(cb) {
  const group = document.getElementById('flat-rate-amount-group');
  if (group) group.style.display = cb.checked ? '' : 'none';
}

async function removeTenant(id, name) {
  if (!confirm(`Remove tenant ${name}? This will mark them as inactive and free the lot.`)) return;
  await API.del(`/tenants/${id}`);
  loadTenants();
}

// =====================================================================
// CSV / Excel Tenant Import
// =====================================================================

// Shared "how to import" guide. Used both on the Tenants page (collapsed)
// and embedded inside the import modal's upload step so users don't have to
// close the wizard to re-read the steps.
function importHelpPanelHtml() {
  return `
    <details class="import-help-panel" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:1rem;overflow:hidden">
      <summary style="padding:0.6rem 0.9rem;cursor:pointer;font-size:0.88rem;color:var(--gray-700);font-weight:500;user-select:none;list-style:none;display:flex;align-items:center;gap:0.4rem">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#e0e7ff;color:#4338ca;font-size:0.72rem;font-weight:700">?</span>
        How to import tenants
      </summary>
      <div style="padding:0 1rem 1rem;font-size:0.85rem;line-height:1.5;color:var(--gray-700)">
        <ol style="padding-left:1.25rem;margin:0.85rem 0 0">
          <li style="margin-bottom:0.85rem">
            <strong style="color:var(--gray-900)">Step 1 — Download the template</strong><br>
            Click <em>Download Template</em> to get a pre-formatted CSV file with the correct column headers.
            <div style="margin-top:0.4rem">
              <button class="btn btn-sm btn-outline" onclick="downloadImportTemplate()">⬇ Download Template</button>
            </div>
          </li>
          <li style="margin-bottom:0.85rem">
            <strong style="color:var(--gray-900)">Step 2 — Fill in your tenant data</strong><br>
            Open in Excel or Google Sheets. One row per lot.<br>
            <strong>Required fields:</strong> Lot Number and Full Name.<br>
            <strong>Optional:</strong> Phone, Email, Monthly Rate, Move-in Date, Lease Type, RV Info, License Plate, Notes.
            <div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:0.4rem 0.6rem;margin-top:0.4rem;font-size:0.8rem;border-radius:0 4px 4px 0">
              💡 <strong>Tip:</strong> Numbers only for rent (no $ sign). Dates in MM/DD/YYYY format.
            </div>
          </li>
          <li style="margin-bottom:0.85rem">
            <strong style="color:var(--gray-900)">Step 3 — Save as CSV or keep as Excel</strong><br>
            <em>Save As CSV</em> in Excel, or <em>Download as CSV</em> from Google Sheets. Excel <code style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:0.78rem">.xlsx</code> files also work.
          </li>
          <li>
            <strong style="color:var(--gray-900)">Step 4 — Upload your file</strong><br>
            Click <em>Import Tenants</em>, select your file, review the column mapping, check the preview, then click <em>Import</em>.
          </li>
        </ol>
      </div>
    </details>
  `;
}

// Target fields the importer can populate, in display order.
var IMPORT_FIELDS = [
  { key: 'lot_id',         label: 'Lot Number',        required: true,
    aliases: ['lot','lotnumber','lotid','site','sitenumber','space','spacenumber','stall'] },
  { key: 'full_name',      label: 'Guest Full Name',   required: true,
    aliases: ['name','fullname','tenant','tenantname','resident','residentname','customer'] },
  { key: 'phone',          label: 'Phone Number',
    aliases: ['phone','phonenumber','tel','telephone','mobile','cell','cellphone','contact','contactnumber'] },
  { key: 'email',          label: 'Email Address',
    aliases: ['email','emailaddress','mail','eaddress'] },
  { key: 'monthly_rent',   label: 'Monthly Rate ($)',
    aliases: ['rent','monthlyrent','monthlyrate','rate','amount','price','lotrent','monthly'] },
  { key: 'move_in_date',   label: 'Move-In Date',
    aliases: ['movein','moveindate','movedin','startdate','start','since','arrival'] },
  { key: 'rent_type',      label: 'Lease Type',
    aliases: ['leasetype','lease','ratetype','renttype','type','billing','billingtype'] },
  { key: 'rv_make_model',  label: 'RV Make/Model',
    aliases: ['rvmakemodel','rvmodel','rvmake','makemodel','rv','unit','rig','coach'] },
  { key: 'rv_length',      label: 'RV Length (ft)',
    aliases: ['rvlength','length','size','ft','feet','rvsize'] },
  { key: 'license_plate',  label: 'License Plate',
    aliases: ['plate','licenseplate','license','tag','tagnumber','platenumber'] },
  { key: 'date_of_birth',  label: 'Date of Birth',
    aliases: ['dateofbirth','dob','birthday','birthdate','birth','bday'] },
  { key: 'notes',          label: 'Notes',
    aliases: ['notes','note','comments','comment','memo','remarks','description'] },
];

// Parsed file state kept across the two-step wizard (file → mapping → results).
var _importState = null;

function showImportTenants() {
  if (API.user?.role !== 'admin') { alert('Admin access required.'); return; }
  _importState = null;
  showModal('📥 Import Tenants', `
    <div style="max-width:640px">
      <p style="margin-top:0">Upload a <strong>CSV</strong> or <strong>Excel (.xlsx)</strong> file to bulk-import or update tenant records. You'll be able to map your columns to our fields and preview the data before anything is saved.</p>

      ${importHelpPanelHtml()}

      <div class="form-group">
        <label><strong>Choose a file</strong></label>
        <input type="file" id="import-file-input" accept=".csv,.xlsx,.xls" onchange="handleImportFile(event)">
      </div>

      <div id="import-file-error" class="error-text" style="display:none"></div>

      <p style="font-size:0.78rem;color:var(--gray-500);margin-top:1rem">
        Existing tenants on a given lot will be <strong>updated</strong>. Lots with no active tenant will receive <strong>new</strong> tenant records. Only admins can run this import.
      </p>
    </div>
  `);
}

async function downloadImportTemplate() {
  try {
    // Authenticated fetch → blob → download. Can't use a plain <a href> because
    // the endpoint requires the bearer token.
    const res = await fetch('/api/tenants/import/template', {
      headers: { 'Authorization': 'Bearer ' + API.token },
    });
    if (!res.ok) throw new Error('Failed to download template');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tenant-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Could not download template: ' + (err.message || 'unknown error'));
  }
}

function handleImportFile(e) {
  var file = e.target.files && e.target.files[0];
  var errEl = document.getElementById('import-file-error');
  if (errEl) errEl.style.display = 'none';
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      // SheetJS handles both CSV and xlsx from a single ArrayBuffer input.
      var data = new Uint8Array(ev.target.result);
      var wb = XLSX.read(data, { type: 'array', cellDates: true });
      var sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error('No sheets found in file');
      var sheet = wb.Sheets[sheetName];
      // header:1 gives us a 2D array so we can treat row 0 as headers.
      // raw:false + dateNF makes dates come through as formatted strings.
      var aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
      if (!aoa.length) throw new Error('File is empty');
      var headers = (aoa[0] || []).map(function(h) { return String(h || '').trim(); });
      var dataRows = aoa.slice(1).filter(function(r) {
        return r.some(function(c) { return String(c || '').trim() !== ''; });
      });
      if (!headers.length) throw new Error('No header row detected');
      if (!dataRows.length) throw new Error('No data rows found after the header');

      _importState = { headers: headers, rows: dataRows, fileName: file.name };
      renderImportMapping();
    } catch (err) {
      if (errEl) {
        errEl.textContent = 'Could not read file: ' + (err.message || 'unknown error');
        errEl.style.display = '';
      }
    }
  };
  reader.onerror = function() {
    if (errEl) { errEl.textContent = 'Failed to read file.'; errEl.style.display = ''; }
  };
  reader.readAsArrayBuffer(file);
}

function _normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _autoDetectMapping(headers) {
  // For each target field, find the first source column whose normalized name
  // matches one of the aliases. Returns { targetKey: sourceIndex | -1 }.
  var used = {};
  var map = {};
  IMPORT_FIELDS.forEach(function(f) {
    map[f.key] = -1;
    for (var i = 0; i < headers.length; i++) {
      if (used[i]) continue;
      var n = _normalizeHeader(headers[i]);
      if (n && f.aliases.indexOf(n) !== -1) {
        map[f.key] = i;
        used[i] = true;
        return;
      }
    }
  });
  return map;
}

function renderImportMapping() {
  var s = _importState;
  if (!s) return;
  var auto = _autoDetectMapping(s.headers);
  var preview = s.rows.slice(0, 5);

  // Build the <option> list per-field so the `selected` flag goes on exactly
  // the right option (avoids substring collisions like "1" matching "10").
  var buildOptions = function(selectedIdx) {
    var skipSel = (selectedIdx === -1) ? ' selected' : '';
    var opts = '<option value="-1"' + skipSel + '>— (skip) —</option>';
    for (var i = 0; i < s.headers.length; i++) {
      var sel = (i === selectedIdx) ? ' selected' : '';
      opts += '<option value="' + i + '"' + sel + '>' +
        escapeHtml(s.headers[i] || '(column ' + (i + 1) + ')') + '</option>';
    }
    return opts;
  };

  var mappingRows = IMPORT_FIELDS.map(function(f) {
    return '<tr>' +
      '<td style="padding:0.35rem 0.5rem;white-space:nowrap">' +
        '<strong>' + escapeHtml(f.label) + '</strong>' +
        (f.required ? ' <span style="color:#dc2626;font-size:0.72rem">*required</span>' : '') +
      '</td>' +
      '<td style="padding:0.35rem 0.5rem">' +
        '<select data-target="' + f.key + '" style="width:100%;padding:0.3rem">' +
          buildOptions(auto[f.key]) +
        '</select>' +
      '</td>' +
    '</tr>';
  }).join('');

  var previewHead = '<tr>' + s.headers.map(function(h) {
    return '<th style="padding:0.3rem 0.5rem;background:#f3f4f6;font-size:0.75rem">' + escapeHtml(h || '') + '</th>';
  }).join('') + '</tr>';

  var previewBody = preview.map(function(row) {
    return '<tr>' + s.headers.map(function(_, i) {
      var v = row[i];
      return '<td style="padding:0.25rem 0.5rem;font-size:0.78rem;border-top:1px solid #e5e7eb">' +
        escapeHtml(v == null ? '' : String(v)) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  showModal('📥 Import Tenants — Step 2: Map Columns', `
    <div style="max-width:900px">
      <p style="margin-top:0">File: <strong>${escapeHtml(s.fileName)}</strong> — <strong>${s.rows.length}</strong> row${s.rows.length === 1 ? '' : 's'} detected.</p>

      <h4 style="margin-bottom:0.35rem">Column Mapping</h4>
      <p style="margin:0 0 0.5rem;font-size:0.8rem;color:var(--gray-500)">Match each of our fields to a column in your file. We've auto-detected matches by column name — adjust as needed.</p>

      <div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:1rem">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f9fafb">
              <th style="text-align:left;padding:0.4rem 0.5rem;font-size:0.8rem">Our Field</th>
              <th style="text-align:left;padding:0.4rem 0.5rem;font-size:0.8rem">Your Column</th>
            </tr>
          </thead>
          <tbody>${mappingRows}</tbody>
        </table>
      </div>

      <h4 style="margin-bottom:0.35rem">Preview (first 5 rows)</h4>
      <div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:6px;max-height:240px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>${previewHead}</thead>
          <tbody>${previewBody}</tbody>
        </table>
      </div>

      <div id="import-mapping-error" class="error-text" style="display:none;margin-top:0.75rem"></div>

      <div class="btn-group" style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:flex-end">
        <button class="btn btn-outline" onclick="showImportTenants()">← Back</button>
        <button class="btn btn-primary" onclick="confirmImportTenants()">Import ${s.rows.length} Row${s.rows.length === 1 ? '' : 's'}</button>
      </div>
    </div>
  `);
}

async function confirmImportTenants() {
  var s = _importState;
  if (!s) return;
  var errEl = document.getElementById('import-mapping-error');
  if (errEl) errEl.style.display = 'none';

  // Collect current select values.
  var mapping = {};
  document.querySelectorAll('select[data-target]').forEach(function(sel) {
    mapping[sel.getAttribute('data-target')] = parseInt(sel.value, 10);
  });

  // Enforce required-field mapping.
  var missing = IMPORT_FIELDS.filter(function(f) { return f.required && (mapping[f.key] === -1 || isNaN(mapping[f.key])); });
  if (missing.length) {
    if (errEl) {
      errEl.textContent = 'Please map the required field(s): ' + missing.map(function(f) { return f.label; }).join(', ');
      errEl.style.display = '';
    }
    return;
  }

  // Prevent the same source column being assigned to multiple targets.
  var usedCols = {};
  var dup = null;
  Object.keys(mapping).forEach(function(k) {
    var v = mapping[k];
    if (v === -1 || isNaN(v)) return;
    if (usedCols[v]) dup = v;
    else usedCols[v] = k;
  });
  if (dup !== null) {
    if (errEl) {
      errEl.textContent = 'Column "' + (s.headers[dup] || '(unnamed)') + '" is mapped to more than one field. Each column can only map to one field.';
      errEl.style.display = '';
    }
    return;
  }

  // Build the payload rows using the mapping.
  var payloadRows = s.rows.map(function(row) {
    var obj = {};
    IMPORT_FIELDS.forEach(function(f) {
      var idx = mapping[f.key];
      if (idx === -1 || isNaN(idx)) return;
      var v = row[idx];
      obj[f.key] = v == null ? '' : String(v).trim();
    });
    return obj;
  });

  // Show a lightweight loading state on the confirm button.
  var btns = document.querySelectorAll('.modal-footer .btn, .btn-group .btn');
  btns.forEach(function(b) { b.disabled = true; });

  try {
    var result = await API.post('/tenants/import', { rows: payloadRows });
    renderImportResults(result);
    // Refresh the tenants list in the background so closing the modal shows new data.
    loadTenants();
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Import failed: ' + (err.message || 'unknown error');
      errEl.style.display = '';
    }
    btns.forEach(function(b) { b.disabled = false; });
  }
}

function renderImportResults(result) {
  var imported = result.imported || 0;
  var errs = result.errors || [];
  var details = result.details || [];
  var created = details.filter(function(d) { return d.action === 'created'; }).length;
  var updated = details.filter(function(d) { return d.action === 'updated'; }).length;

  // Stash errors for the CSV download.
  window._importErrors = errs;

  var summary =
    '<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem">' +
      '<div style="flex:1;min-width:140px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:0.75rem;text-align:center">' +
        '<div style="font-size:1.75rem;font-weight:800;color:#047857">' + imported + '</div>' +
        '<div style="font-size:0.78rem;color:#065f46">imported successfully</div>' +
        '<div style="font-size:0.7rem;color:#059669;margin-top:0.2rem">' + created + ' created · ' + updated + ' updated</div>' +
      '</div>' +
      '<div style="flex:1;min-width:140px;background:' + (errs.length ? '#fef2f2' : '#f9fafb') + ';border:1px solid ' + (errs.length ? '#fecaca' : '#e5e7eb') + ';border-radius:6px;padding:0.75rem;text-align:center">' +
        '<div style="font-size:1.75rem;font-weight:800;color:' + (errs.length ? '#b91c1c' : '#6b7280') + '">' + errs.length + '</div>' +
        '<div style="font-size:0.78rem;color:' + (errs.length ? '#991b1b' : '#6b7280') + '">row' + (errs.length === 1 ? '' : 's') + ' with errors</div>' +
      '</div>' +
    '</div>';

  var errorList = '';
  if (errs.length) {
    errorList =
      '<h4 style="margin-bottom:0.35rem">Errors</h4>' +
      '<div style="overflow-x:auto;border:1px solid #fecaca;border-radius:6px;max-height:260px;overflow-y:auto">' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.8rem">' +
          '<thead><tr style="background:#fef2f2">' +
            '<th style="padding:0.35rem 0.5rem;text-align:left">Row</th>' +
            '<th style="padding:0.35rem 0.5rem;text-align:left">Lot</th>' +
            '<th style="padding:0.35rem 0.5rem;text-align:left">Name</th>' +
            '<th style="padding:0.35rem 0.5rem;text-align:left">Reason</th>' +
          '</tr></thead>' +
          '<tbody>' +
            errs.map(function(e) {
              return '<tr style="border-top:1px solid #fee2e2">' +
                '<td style="padding:0.3rem 0.5rem">' + (e.row || '') + '</td>' +
                '<td style="padding:0.3rem 0.5rem">' + escapeHtml(e.lot_id || '') + '</td>' +
                '<td style="padding:0.3rem 0.5rem">' + escapeHtml(e.name || '') + '</td>' +
                '<td style="padding:0.3rem 0.5rem;color:#991b1b">' + escapeHtml(e.error || '') + '</td>' +
              '</tr>';
            }).join('') +
          '</tbody>' +
        '</table>' +
      '</div>' +
      '<div style="margin-top:0.5rem">' +
        '<button class="btn btn-sm btn-outline" onclick="downloadImportErrorReport()">⬇ Download Error Report (CSV)</button>' +
      '</div>';
  }

  showModal('📥 Import Tenants — Results', `
    <div style="max-width:720px">
      ${summary}
      ${errorList}
      <div class="btn-group" style="margin-top:1.25rem;display:flex;gap:0.5rem;justify-content:flex-end">
        <button class="btn btn-primary" onclick="closeModal()">Done</button>
      </div>
    </div>
  `);
}

function downloadImportErrorReport() {
  var errs = window._importErrors || [];
  if (!errs.length) return;
  var csvCell = function(v) {
    var s = String(v == null ? '' : v);
    // Escape quotes per RFC 4180 and wrap if the cell contains delimiters.
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  var lines = ['Row,Lot,Name,Error'];
  errs.forEach(function(e) {
    lines.push([e.row || '', e.lot_id || '', e.name || '', e.error || ''].map(csvCell).join(','));
  });
  var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'tenant-import-errors-' + new Date().toISOString().split('T')[0] + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function promptTenantReview(tenantId, tenantName) {
  try {
    const check = await API.get('/reviews/can-send/' + tenantId);
    if (!check.enabled) { showStatusToast('ℹ️', 'Review requests are disabled in settings'); return; }
    if (check.alreadySent) { showStatusToast('ℹ️', 'Review request already sent to ' + tenantName + ' recently'); return; }
  } catch { /* proceed anyway */ }

  showModal('Send a Review Request?', `
    <div style="text-align:center;padding:0.5rem">
      <div style="font-size:2.5rem;margin-bottom:0.5rem">⭐</div>
      <p style="font-size:1rem;margin-bottom:0.5rem">Send a review request to <strong>${escapeHtml(tenantName)}</strong>?</p>
      <p style="font-size:0.85rem;color:var(--gray-500);margin-bottom:1.5rem">A friendly SMS and email will be sent asking them to leave a Google review. This helps us attract new guests!</p>
      <div class="btn-group" style="justify-content:center">
        <button class="btn btn-primary" id="send-review-btn">Send Review Request</button>
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      </div>
    </div>
  `);
  setTimeout(function() {
    var btn = document.getElementById('send-review-btn');
    if (btn) btn.addEventListener('click', async function() {
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        const result = await API.post('/reviews/send', { tenant_id: tenantId });
        closeModal();
        if (result.skipped) {
          showStatusToast('ℹ️', 'Review request already sent recently');
        } else {
          showStatusToast('⭐', 'Review request sent via ' + (result.method || 'message') + '!');
        }
      } catch (err) {
        closeModal();
        showStatusToast('⚠️', 'Failed: ' + (err.message || 'unknown error'));
      }
    });
  }, 100);
}

// === CREDIT MANAGEMENT MODALS ===

async function showTransferCredit(tenantId, creditBalance, tenantName, lotId) {
  var tenants = await API.get('/tenants');
  var others = tenants.filter(function(t) { return t.id !== tenantId && t.is_active; });
  showModal('Transfer Credit', `
    <div style="margin-bottom:1rem">
      <div style="font-size:0.85rem;color:var(--gray-500)">From</div>
      <div style="font-weight:700">${escapeHtml(tenantName)} — Lot ${escapeHtml(lotId)}</div>
      <div style="color:#16a34a;font-weight:600">Credit available: ${formatMoney(creditBalance)}</div>
    </div>
    <form id="transfer-credit-form">
      <div class="form-group">
        <label>Transfer to Guest</label>
        <select name="to_tenant_id" required>
          <option value="">Select guest...</option>
          ${others.map(function(t) { return '<option value="' + t.id + '">' + t.lot_id + ' - ' + t.first_name + ' ' + t.last_name + '</option>'; }).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Amount to Transfer ($)</label>
        <input name="amount" type="number" step="0.01" min="0.01" max="${creditBalance}" value="${creditBalance.toFixed(2)}" inputmode="decimal" required>
      </div>
      <div class="form-group">
        <label>Reason <span style="font-weight:400;color:var(--gray-400)">(optional)</span></label>
        <textarea name="reason" placeholder="e.g. Parent paying for child at H4"></textarea>
      </div>
      <p id="transfer-error" class="error-text" style="display:none"></p>
      <div class="btn-group mt-2">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Transfer</button>
      </div>
    </form>
  `);
  setTimeout(function() {
    var form = document.getElementById('transfer-credit-form');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var fd = new FormData(form);
      var errEl = document.getElementById('transfer-error');
      try {
        var r = await API.post('/credits/transfer', {
          from_tenant_id: tenantId,
          to_tenant_id: parseInt(fd.get('to_tenant_id')),
          amount: parseFloat(fd.get('amount')),
          reason: fd.get('reason') || '',
        });
        closeModal();
        showStatusToast('✅', 'Transferred ' + formatMoney(r.transferred) + ' from ' + r.from.name + ' to ' + r.to.name);
        loadTenants();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Transfer failed'; errEl.style.display = ''; }
      }
    });
  }, 50);
}

async function showRefundCredit(tenantId, creditBalance, tenantName) {
  showModal('Refund Credit', `
    <div style="margin-bottom:1rem">
      <div style="font-weight:700">${escapeHtml(tenantName)}</div>
      <div style="color:#16a34a;font-weight:600">Credit available: ${formatMoney(creditBalance)}</div>
    </div>
    <form id="refund-credit-form">
      <div class="form-group">
        <label>Refund Amount ($)</label>
        <input name="amount" type="number" step="0.01" min="0.01" max="${creditBalance}" value="${creditBalance.toFixed(2)}" inputmode="decimal" required>
      </div>
      <div class="form-group">
        <label>Refund Method</label>
        <select name="payment_method">
          <option value="cash">Cash</option>
          <option value="check">Check</option>
          <option value="card">Card</option>
          <option value="zelle">Zelle</option>
          <option value="venmo">Venmo</option>
        </select>
      </div>
      <div class="form-group">
        <label>Reference # <span style="font-weight:400;color:var(--gray-400)">(optional)</span></label>
        <input name="reference_number" placeholder="Check number, etc.">
      </div>
      <div class="form-group">
        <label>Reason <span style="font-weight:400;color:var(--gray-400)">(optional)</span></label>
        <input name="reason" placeholder="e.g. Guest requested cash refund">
      </div>
      <p id="refund-error" class="error-text" style="display:none"></p>
      <div class="btn-group mt-2">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" style="background:#dc2626;border-color:#dc2626">Refund</button>
      </div>
    </form>
  `);
  setTimeout(function() {
    var form = document.getElementById('refund-credit-form');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var fd = new FormData(form);
      var errEl = document.getElementById('refund-error');
      try {
        var r = await API.post('/credits/refund', {
          tenant_id: tenantId,
          amount: parseFloat(fd.get('amount')),
          payment_method: fd.get('payment_method'),
          reference_number: fd.get('reference_number') || '',
          reason: fd.get('reason') || '',
        });
        closeModal();
        showStatusToast('✅', 'Refunded ' + formatMoney(r.refunded) + '. New credit balance: ' + formatMoney(r.new_balance));
        loadTenants();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Refund failed'; errEl.style.display = ''; }
      }
    });
  }, 50);
}

async function showApplyCredit(tenantId, creditBalance, tenantName) {
  var invoices = [];
  try {
    var all = await API.get('/invoices?tenant_id=' + tenantId);
    invoices = all.filter(function(inv) { return inv.status !== 'paid' && !inv.deleted && Number(inv.balance_due) > 0; });
  } catch (e) {}

  if (invoices.length === 0) {
    showStatusToast('ℹ️', 'No unpaid invoices to apply credit to.');
    return;
  }

  showModal('Apply Credit to Invoice', `
    <div style="margin-bottom:1rem">
      <div style="font-weight:700">${escapeHtml(tenantName)}</div>
      <div style="color:#16a34a;font-weight:600">Credit available: ${formatMoney(creditBalance)}</div>
    </div>
    <form id="apply-credit-form">
      <div class="form-group">
        <label>Invoice</label>
        <select name="invoice_id" id="apply-credit-invoice" required>
          ${invoices.map(function(inv) { return '<option value="' + inv.id + '" data-balance="' + inv.balance_due + '">' + (inv.invoice_number || 'Invoice #' + inv.id) + ' — ' + formatMoney(inv.balance_due) + ' due</option>'; }).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Amount to Apply ($)</label>
        <input name="amount" id="apply-credit-amount" type="number" step="0.01" min="0.01" inputmode="decimal" required>
      </div>
      <div id="apply-credit-calc" style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:0.5rem 0.75rem;font-size:0.85rem;color:#1e40af;margin-bottom:0.5rem"></div>
      <p id="apply-credit-error" class="error-text" style="display:none"></p>
      <div class="btn-group mt-2">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" style="background:#16a34a;border-color:#16a34a">Apply Credit</button>
      </div>
    </form>
  `);
  setTimeout(function() {
    var invSelect = document.getElementById('apply-credit-invoice');
    var amtInput = document.getElementById('apply-credit-amount');
    function updateCalc() {
      var opt = invSelect.selectedOptions[0];
      var invBal = opt ? parseFloat(opt.dataset.balance) : 0;
      var maxApply = Math.min(creditBalance, invBal);
      amtInput.max = maxApply;
      if (!amtInput.value) amtInput.value = maxApply.toFixed(2);
      var amt = parseFloat(amtInput.value) || 0;
      var applied = Math.min(amt, maxApply);
      var calc = document.getElementById('apply-credit-calc');
      if (calc) {
        var remInv = Math.max(0, invBal - applied);
        var remCredit = Math.max(0, creditBalance - applied);
        calc.innerHTML = 'After applying: Invoice balance <strong>' + formatMoney(remInv) + '</strong> | Remaining credit <strong>' + formatMoney(remCredit) + '</strong>';
      }
    }
    updateCalc();
    if (invSelect) invSelect.addEventListener('change', updateCalc);
    if (amtInput) amtInput.addEventListener('input', updateCalc);

    var form = document.getElementById('apply-credit-form');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var fd = new FormData(form);
      var errEl = document.getElementById('apply-credit-error');
      try {
        var r = await API.post('/credits/apply-to-invoice', {
          tenant_id: tenantId,
          invoice_id: parseInt(fd.get('invoice_id')),
          amount: parseFloat(fd.get('amount')),
        });
        closeModal();
        showStatusToast('✅', 'Applied ' + formatMoney(r.applied) + ' credit. Invoice balance: ' + formatMoney(r.new_invoice_balance));
        loadTenants();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Failed'; errEl.style.display = ''; }
      }
    });
  }, 50);
}

async function showCreditHistory(tenantId, tenantName) {
  var history = [];
  try { history = await API.get('/credits/history/' + tenantId); } catch (e) {}
  var typeLabels = {
    overpayment: '💰 Overpayment',
    transfer_in: '📥 Transfer In',
    transfer_out: '📤 Transfer Out',
    applied_to_invoice: '📋 Applied to Invoice',
    refund: '💸 Refund',
    hold_as_credit: '🏦 Held as Credit',
    manual_add: '➕ Manual Adjustment',
  };
  showModal('Credit History — ' + tenantName, `
    <div style="max-height:400px;overflow-y:auto">
      ${history.length === 0 ? '<p style="color:var(--gray-400);text-align:center;padding:1rem">No credit transactions recorded yet.</p>' : `
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        <thead><tr style="border-bottom:2px solid var(--gray-200)">
          <th style="text-align:left;padding:0.4rem">Date</th>
          <th style="text-align:left;padding:0.4rem">Type</th>
          <th style="text-align:right;padding:0.4rem">Amount</th>
          <th style="text-align:left;padding:0.4rem">Details</th>
        </tr></thead>
        <tbody>
          ${history.map(function(h) {
            var isPositive = h.amount > 0;
            return '<tr style="border-bottom:1px solid var(--gray-100)">' +
              '<td style="padding:0.4rem;white-space:nowrap">' + formatDate(h.created_at) + '</td>' +
              '<td style="padding:0.4rem">' + (typeLabels[h.transaction_type] || h.transaction_type) + '</td>' +
              '<td style="padding:0.4rem;text-align:right;font-weight:600;color:' + (isPositive ? '#16a34a' : '#dc2626') + '">' + (isPositive ? '+' : '') + formatMoney(Math.abs(h.amount)) + '</td>' +
              '<td style="padding:0.4rem;font-size:0.78rem;color:var(--gray-500)">' + escapeHtml(h.notes || '') + (h.related_tenant_name ? ' (' + escapeHtml(h.related_tenant_name) + ')' : '') + '</td>' +
              '</tr>';
          }).join('')}
        </tbody>
      </table>`}
    </div>
  `);
}
