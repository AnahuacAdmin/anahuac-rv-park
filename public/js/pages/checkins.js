/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
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

let _checkinDefaultFlatRate = 0;

function toggleCheckinFlatRate(cb) {
  const group = document.getElementById('checkin-flat-rate-group');
  if (group) group.style.display = cb.checked ? '' : 'none';
}

async function showCheckIn() {
  const [lots, settings] = await Promise.all([API.get('/lots'), API.get('/settings')]);
  _checkinDefaultFlatRate = parseFloat(settings?.default_flat_rate) || 0;
  const vacantLots = lots.filter(l => l.status === 'vacant');

  showModal('Check-In New Tenant', `
    <form onsubmit="processCheckIn(event)">
      <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
        <legend><strong>Tenant Info</strong></legend>
        <div class="form-row">
          <div class="form-group"><label>First Name</label><input name="first_name" required></div>
          <div class="form-group"><label>Last Name</label><input name="last_name" required></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Phone</label><input name="phone"></div>
          <div class="form-group"><label>Email</label><input name="email" type="email"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>ID / Driver's License #</label><input name="id_number" placeholder="For records only"></div>
          <div class="form-group"><label>Date of Birth</label><input name="date_of_birth" type="date"></div>
        </div>
      </fieldset>

      <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
        <legend><strong>Lot & Rate</strong></legend>
        <div class="form-row">
          <div class="form-group">
            <label>Assign to Lot</label>
            <select name="lot_id" required>
              <option value="">Select lot...</option>
              ${vacantLots.map(l => `<option value="${l.id}">${l.id}${l.size_restriction ? ' (' + l.size_restriction + ')' : ''}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Rate Type</label>
            <select name="rent_type" onchange="updateRateLabel(this)">
              <option value="monthly" selected>Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label id="rate-label">Monthly Rate ($)</label><input name="monthly_rent" type="number" step="0.01" value="295"></div>
          <div class="form-group"><label>Check-In Date</label><input name="check_in_date" type="date" value="${new Date().toISOString().split('T')[0]}" required onchange="calcProration(this.form)"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Deposit Paid ($)</label><input name="deposit_amount" type="number" step="0.01" value="0"></div>
          <div class="form-group"></div>
        </div>
        <div style="border:1px solid #16a34a;border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.75rem">
          <label style="display:flex;align-items:center;gap:0.5rem;font-weight:600;font-size:0.85rem;cursor:pointer;margin-bottom:0">
            <input type="checkbox" name="flat_rate" value="1" onchange="toggleCheckinFlatRate(this)"> Flat Rate Billing
          </label>
          <p style="font-size:0.75rem;color:#78716c;margin:0.2rem 0 0 1.5rem">Covers all charges including electric — one fixed monthly amount</p>
          <div id="checkin-flat-rate-group" style="display:none;margin-top:0.5rem">
            <div class="form-group" style="margin-bottom:0"><label>Flat Rate Amount ($/month)</label><input name="flat_rate_amount" type="number" step="0.01" value="${_checkinDefaultFlatRate || 0}" placeholder="e.g. 450"></div>
          </div>
        </div>
        <div id="proration-info" style="display:none;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.5rem">
          <strong style="color:#1e40af">Prorated First Month</strong>
          <div id="proration-detail" style="font-size:0.9rem;margin-top:0.25rem"></div>
        </div>
      </fieldset>

      <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
        <legend><strong>Vehicle / RV</strong></legend>
        <div class="form-row">
          <div class="form-group"><label>RV Make</label><input name="rv_make" placeholder="e.g. Keystone"></div>
          <div class="form-group"><label>RV Model</label><input name="rv_model" placeholder="e.g. Cougar"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Year</label><input name="rv_year" placeholder="e.g. 2020"></div>
          <div class="form-group"><label>Length (ft)</label><input name="rv_length" placeholder="e.g. 32"></div>
        </div>
        <div class="form-group"><label>License Plate</label><input name="license_plate" placeholder="e.g. ABC-1234"></div>
      </fieldset>

      <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
        <legend><strong>Emergency Contact</strong></legend>
        <div class="form-row">
          <div class="form-group"><label>Contact Name</label><input name="emergency_contact"></div>
          <div class="form-group"><label>Contact Phone</label><input name="emergency_phone"></div>
        </div>
      </fieldset>

      <div class="form-group"><label>Notes</label><textarea name="notes"></textarea></div>
      <button type="submit" class="btn btn-success btn-full mt-2">Check In</button>
      <p id="checkin-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

function updateRateLabel(sel) {
  const label = document.getElementById('rate-label');
  const input = sel.form.monthly_rent;
  const type = sel.value;
  if (type === 'daily') { if (label) label.textContent = 'Daily Rate ($)'; if (input && input.value === '295') input.value = '50'; }
  else if (type === 'weekly') { if (label) label.textContent = 'Weekly Rate ($)'; if (input && input.value === '295') input.value = '200'; }
  else { if (label) label.textContent = 'Monthly Rate ($)'; }
  calcProration(sel.form);
}

function calcProration(form) {
  const infoEl = document.getElementById('proration-info');
  const detailEl = document.getElementById('proration-detail');
  if (!infoEl || !detailEl) return;

  const type = form.rent_type?.value || 'monthly';
  const dateVal = form.check_in_date?.value;
  const rate = parseFloat(form.monthly_rent?.value) || 0;

  // No proration for daily/weekly
  if (type !== 'monthly' || !dateVal || !rate) { infoEl.style.display = 'none'; return; }

  const moveIn = new Date(dateVal + 'T00:00:00');
  const day = moveIn.getDate();
  if (day === 1) { infoEl.style.display = 'none'; return; } // 1st of month = no proration

  const year = moveIn.getFullYear();
  const month = moveIn.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const remainingDays = daysInMonth - day + 1; // Include move-in day
  const prorated = +((rate / daysInMonth) * remainingDays).toFixed(2);
  const monthName = moveIn.toLocaleString('default', { month: 'long' });

  detailEl.innerHTML = `Move-in: ${monthName} ${day} = <strong>${remainingDays} days remaining</strong> of ${daysInMonth}<br>` +
    `$${rate.toFixed(2)} / ${daysInMonth} days × ${remainingDays} days = <strong style="color:#16a34a">$${prorated.toFixed(2)} prorated</strong>`;
  infoEl.style.display = '';
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
    // Create tenant with all intake fields
    tenant = await API.post('/tenants', {
      lot_id: data.lot_id, first_name: data.first_name, last_name: data.last_name,
      phone: data.phone, email: data.email, monthly_rent: parseFloat(data.monthly_rent),
      rent_type: data.rent_type || 'monthly', move_in_date: data.check_in_date,
      rv_make: data.rv_make, rv_model: data.rv_model, rv_year: data.rv_year,
      rv_length: data.rv_length, license_plate: data.license_plate,
      emergency_contact: data.emergency_contact, emergency_phone: data.emergency_phone,
      id_number: data.id_number, date_of_birth: data.date_of_birth,
      deposit_amount: parseFloat(data.deposit_amount) || 0,
      flat_rate: data.flat_rate === '1' ? 1 : 0,
      flat_rate_amount: parseFloat(data.flat_rate_amount) || 0,
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

  // Auto-generate prorated invoice for mid-month move-in (monthly tenants only)
  const rentType = data.rent_type || 'monthly';
  const moveInDate = new Date(data.check_in_date + 'T00:00:00');
  const moveDay = moveInDate.getDate();
  if (rentType === 'monthly' && moveDay > 1) {
    try {
      const monthlyRate = parseFloat(data.monthly_rent) || 0;
      const yr = moveInDate.getFullYear();
      const mo = moveInDate.getMonth();
      const dim = new Date(yr, mo + 1, 0).getDate();
      const remaining = dim - moveDay + 1;
      const prorated = +((monthlyRate / dim) * remaining).toFixed(2);
      const moName = moveInDate.toLocaleString('default', { month: 'long' });
      const endDate = `${yr}-${String(mo + 1).padStart(2, '0')}-${dim}`;
      await API.post('/invoices', {
        tenant_id: tenant.id,
        invoice_date: data.check_in_date,
        due_date: data.check_in_date,
        billing_period_start: data.check_in_date,
        billing_period_end: endDate,
        rent_amount: prorated,
        notes: `Prorated - ${moName} ${yr} (${remaining}/${dim} days)`,
      });
      console.log(`Prorated invoice created: $${prorated} for ${remaining} days`);
    } catch (err) {
      console.error('Prorated invoice failed (non-fatal):', err);
    }
  }

  closeModal();

  // Show success with option to send welcome text.
  const tenantName = `${data.first_name} ${data.last_name}`;
  const phone = data.phone;
  celebrateTenantCheckIn(data.first_name, data.lot_id);
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
      <button class="btn btn-primary btn-full mt-2" onclick="printWelcomeCard('${tenantName.replace(/'/g, "\\'")}', '${data.lot_id}', ${tenant.id})">
        &#128438; Print Welcome Card
      </button>
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

let _checkoutTenants = [];

async function showCheckOut() {
  _checkoutTenants = await API.get('/tenants');
  showModal('Check-Out Tenant', `
    <form onsubmit="processCheckOut(event)">
      <div class="form-group">
        <label>Select Tenant</label>
        <select name="tenant_select" required onchange="checkoutSelected(this)">
          <option value="">Select tenant...</option>
          ${_checkoutTenants.map(t => `<option value="${t.id}|${t.lot_id}">${t.lot_id} - ${t.first_name} ${t.last_name}</option>`).join('')}
        </select>
        <input type="hidden" name="tenant_id">
        <input type="hidden" name="lot_id">
      </div>
      <div class="form-group"><label>Check-Out Date</label><input name="check_out_date" type="date" value="${new Date().toISOString().split('T')[0]}" required></div>

      <div id="deposit-section" style="display:none"></div>

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

  const tenant = _checkoutTenants.find(t => t.id === parseInt(tid));
  const deposit = Number(tenant?.deposit_amount) || 0;
  const balance = Number(tenant?.balance_due) || 0;
  const section = document.getElementById('deposit-section');

  if (deposit > 0) {
    section.style.display = '';
    section.innerHTML = `
      <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
        <legend><strong>Deposit Settlement</strong></legend>
        <div style="display:flex;gap:1.5rem;margin-bottom:0.75rem;font-size:0.9rem">
          <div><strong>Deposit on file:</strong> <span style="color:var(--brand-primary,#1a5c32);font-weight:700">${formatMoney(deposit)}</span></div>
          <div><strong>Balance owed:</strong> <span style="color:${balance > 0 ? '#dc2626' : '#16a34a'};font-weight:700">${formatMoney(balance)}</span></div>
        </div>
        <div class="form-group">
          <label>Deposit Disposition</label>
          <select name="deposit_action" onchange="updateDepositCalc(this, ${deposit}, ${balance})">
            <option value="full_refund">Full Refund — return ${formatMoney(deposit)}</option>
            <option value="partial_refund">Partial Refund — deduct damages/cleaning</option>
            ${balance > 0 ? `<option value="apply_to_balance">Apply to Balance — reduce ${formatMoney(balance)} owed</option>` : ''}
            <option value="no_refund">No Refund — tenant forfeits deposit</option>
          </select>
        </div>
        <div id="deposit-partial" style="display:none">
          <div class="form-row">
            <div class="form-group">
              <label>Deduction Amount ($)</label>
              <input name="deduction_amount" type="number" step="0.01" min="0" max="${deposit}" value="0" oninput="calcDepositRefund(this, ${deposit})">
            </div>
            <div class="form-group">
              <label>Deduction Reason</label>
              <input name="deduction_reason" placeholder="Damages, cleaning, etc.">
            </div>
          </div>
          <div id="deposit-refund-calc" style="background:#f0fdf4;border:1px solid #dcfce7;border-radius:8px;padding:0.5rem 0.75rem;font-size:0.9rem;color:#1a5c32">
            Refund amount: <strong>${formatMoney(deposit)}</strong>
          </div>
        </div>
        <div id="deposit-apply-info" style="display:none;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:0.5rem 0.75rem;font-size:0.9rem;color:#1e40af">
          ${deposit >= balance
            ? `Deposit covers full balance. Remaining <strong>${formatMoney(deposit - balance)}</strong> will be refunded.`
            : `Deposit reduces balance from ${formatMoney(balance)} to <strong>${formatMoney(balance - deposit)}</strong>. No refund.`}
        </div>
      </fieldset>
    `;
  } else {
    section.style.display = 'none';
    section.innerHTML = '';
  }
}

function updateDepositCalc(sel, deposit, balance) {
  const partial = document.getElementById('deposit-partial');
  const applyInfo = document.getElementById('deposit-apply-info');
  if (partial) partial.style.display = sel.value === 'partial_refund' ? '' : 'none';
  if (applyInfo) applyInfo.style.display = sel.value === 'apply_to_balance' ? '' : 'none';
}

function calcDepositRefund(input, deposit) {
  const deduction = Math.min(Math.max(parseFloat(input.value) || 0, 0), deposit);
  const refund = deposit - deduction;
  const el = document.getElementById('deposit-refund-calc');
  if (el) el.innerHTML = `Refund amount: <strong>${formatMoney(refund)}</strong>`;
}

async function processCheckOut(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const errEl = document.getElementById('checkout-error');
  if (errEl) errEl.style.display = 'none';
  try {
    const result = await API.post('/checkins/checkout', {
      tenant_id: parseInt(form.get('tenant_id')),
      lot_id: form.get('lot_id'),
      check_out_date: form.get('check_out_date'),
      notes: form.get('notes'),
      deposit_action: form.get('deposit_action') || null,
      deduction_amount: parseFloat(form.get('deduction_amount')) || 0,
      deduction_reason: form.get('deduction_reason') || null,
    });
    closeModal();

    // Show Move-Out Statement if deposit was settled
    if (result.statement) {
      const s = result.statement;
      showModal('Move-Out Statement', `
        <div style="max-width:500px;margin:0 auto">
          <div style="text-align:center;border-bottom:2px solid var(--gray-200);padding-bottom:0.75rem;margin-bottom:1rem">
            <div style="font-size:1.1rem;font-weight:700;color:var(--brand-primary,#1a5c32)">Anahuac RV Park</div>
            <div style="font-size:0.8rem;color:var(--gray-500)">Move-Out Statement</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.9rem;margin-bottom:1rem">
            <div><strong>Tenant:</strong> ${escapeHtml(s.tenant_name)}</div>
            <div><strong>Lot:</strong> ${escapeHtml(s.lot_id)}</div>
            <div><strong>Move-Out:</strong> ${formatDate(s.checkout_date)}</div>
            <div><strong>Action:</strong> ${escapeHtml(s.action_label)}</div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin-bottom:1rem">
            <tbody>
              <tr style="border-bottom:1px solid var(--gray-200)"><td style="padding:0.4rem 0">Deposit on File</td><td style="padding:0.4rem 0;text-align:right;font-weight:600">${formatMoney(s.deposit)}</td></tr>
              ${s.deduction > 0 ? `<tr style="border-bottom:1px solid var(--gray-200)"><td style="padding:0.4rem 0;color:#dc2626">Deductions${s.deduction_reason ? ' (' + escapeHtml(s.deduction_reason) + ')' : ''}</td><td style="padding:0.4rem 0;text-align:right;color:#dc2626">-${formatMoney(s.deduction)}</td></tr>` : ''}
              ${s.applied_to_balance > 0 ? `<tr style="border-bottom:1px solid var(--gray-200)"><td style="padding:0.4rem 0;color:#0284c7">Applied to Balance</td><td style="padding:0.4rem 0;text-align:right;color:#0284c7">-${formatMoney(s.applied_to_balance)}</td></tr>` : ''}
              <tr style="border-top:2px solid var(--gray-900)"><td style="padding:0.5rem 0;font-weight:700;font-size:1rem">${s.refund > 0 ? 'Refund Due to Tenant' : 'Net Refund'}</td><td style="padding:0.5rem 0;text-align:right;font-weight:700;font-size:1rem;color:${s.refund > 0 ? '#16a34a' : 'var(--gray-700)'}">${formatMoney(s.refund)}</td></tr>
            </tbody>
          </table>
          ${s.remaining_balance > 0 ? `<div style="background:#fee2e2;border-radius:8px;padding:0.5rem 0.75rem;font-size:0.85rem;color:#991b1b;margin-bottom:1rem">Remaining balance owed: <strong>${formatMoney(s.remaining_balance)}</strong></div>` : ''}
          <div class="btn-group" style="justify-content:center">
            <button class="btn btn-outline" onclick="window.print()">🖨️ Print</button>
            <button class="btn btn-primary" onclick="closeModal();loadCheckins()">Done</button>
          </div>
        </div>
      `);
    } else {
      loadCheckins();
    }
  } catch (err) {
    const msg = err.message || 'Check-out failed';
    if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
    else alert('Check-out failed: ' + msg);
  }
}

async function printWelcomeCard(tenantName, lotId, tenantId) {
  // Fetch WiFi password from settings.
  let wifiPassword = '';
  try {
    const settings = await API.get('/settings');
    wifiPassword = settings?.wifi_password || '';
  } catch {}

  const payUrl = `${APP_URL}/pay.html?pay=${tenantId}`;

  // Build the welcome card in a new window for clean printing.
  const w = window.open('', '_blank', 'width=600,height=800');
  if (!w) { alert('Popup blocked — please allow popups for this site.'); return; }

  w.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Welcome Card - ${tenantName}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: 5.5in 8.5in; margin: 0.3in; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; width: 5.5in; margin: 0 auto; padding: 0.3in; color: #1f2937; }
  .card-border { border: 3px solid #2c4a1e; border-radius: 12px; padding: 0.4in 0.35in; min-height: 7.5in; display: flex; flex-direction: column; }
  .header { text-align: center; margin-bottom: 0.25in; }
  .header img { height: 70px; margin-bottom: 6px; }
  .header h1 { color: #2c4a1e; font-size: 18pt; margin-bottom: 2px; }
  .header h2 { color: #4ade80; font-size: 11pt; font-weight: 600; letter-spacing: 1px; }
  .tenant-info { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; margin-bottom: 0.2in; text-align: center; }
  .tenant-info .name { font-size: 14pt; font-weight: 700; color: #2c4a1e; }
  .tenant-info .lot { font-size: 11pt; color: #166534; margin-top: 2px; }
  .wifi-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 14px; margin-bottom: 0.2in; text-align: center; }
  .wifi-box .label { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #92400e; }
  .wifi-box .password { font-size: 16pt; font-weight: 800; color: #78350f; letter-spacing: 2px; }
  .contact { text-align: center; font-size: 8.5pt; color: #555; margin-bottom: 0.15in; }
  .rules { flex: 1; }
  .rules h3 { font-size: 9pt; color: #2c4a1e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; }
  .rules ul { list-style: none; padding: 0; }
  .rules li { font-size: 8pt; padding: 2px 0; border-bottom: 1px dotted #e5e7eb; }
  .rules li:last-child { border-bottom: none; }
  .rules li::before { content: '•'; color: #2c4a1e; font-weight: 700; margin-right: 5px; }
  .warning { font-size: 7pt; color: #991b1b; text-align: center; margin-top: 6px; font-style: italic; }
  .pay-section { text-align: center; margin-top: 0.15in; padding-top: 0.1in; border-top: 1px solid #d1d5db; }
  .pay-section p { font-size: 8pt; color: #555; margin-bottom: 6px; }
  .pay-section .url { font-size: 8pt; color: #2c4a1e; font-weight: 600; }
  #qr-code { display: inline-block; margin-top: 4px; }
  @media print { body { padding: 0; } }
</style>
</head><body>
<div class="card-border">
  <div class="header">
    <img src="/park_Logo.png" alt="Anahuac RV Park">
    <h1>Welcome to Anahuac RV Park!</h1>
    <h2>Your Home Away From Home</h2>
  </div>
  <div class="tenant-info">
    <div class="name">${escapeHtml(tenantName)}</div>
    <div class="lot">Lot ${lotId}</div>
  </div>
  ${wifiPassword ? `<div class="wifi-box"><div class="label">WiFi Password</div><div class="password">${escapeHtml(wifiPassword)}</div></div>` : ''}
  <div class="contact">409-267-6603 &nbsp;|&nbsp; anrvpark.com &nbsp;|&nbsp; 1003 Davis Ave, Anahuac TX 77514</div>
  <div class="rules">
    <h3>Park Rules</h3>
    <ul>
      <li>Speed limit 5 MPH — children &amp; ducks in park!</li>
      <li>Quiet hours 10pm – 7am</li>
      <li>Pets welcome on leash — clean up after them</li>
      <li>Max 2 people per space ($25/extra person)</li>
      <li>No fires except pits/rings. No fireworks. No weapons.</li>
      <li>Keep your site clean at all times</li>
      <li>Rent due on time — late fees apply after 3 days</li>
      <li>No subleasing. No sharing WiFi password.</li>
      <li>Guests: max 2 visitors at a time</li>
    </ul>
    <p class="warning">Management reserves the right to remove guests who disregard rules.</p>
  </div>
  <div class="pay-section">
    <p>Pay your invoice online at <strong>anrvpark.com</strong> or scan the QR code:</p>
    <div id="qr-code"></div>
    <div class="url">${payUrl}</div>
  </div>
</div>
<script>
  new QRCode(document.getElementById('qr-code'), { text: '${payUrl}', width: 80, height: 80, colorDark: '#2c4a1e', colorLight: '#ffffff' });
  setTimeout(function() { window.print(); }, 500);
<\/script>
</body></html>`);
  w.document.close();
}

