/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
function toggleCheckinPaymentNote(method) {
  var cardNote = document.getElementById('checkin-payment-card-note');
  var refGroup = document.getElementById('checkin-payment-ref-group');
  if (cardNote) cardNote.style.display = method === 'card' ? '' : 'none';
  if (refGroup) refGroup.style.display = (method && method !== 'card') ? '' : 'none';
}

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
        <button class="btn btn-success" id="btn-checkin">Check-In</button>
        <button class="btn btn-warning" id="btn-checkout">Check-Out</button>
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
  // Wire buttons via addEventListener (CSP-safe)
  document.getElementById('btn-checkin').addEventListener('click', showCheckIn);
  document.getElementById('btn-checkout').addEventListener('click', showCheckOut);
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
            <select name="lot_id" id="checkin-lot-select" required>
              <option value="">Select lot...</option>
              ${vacantLots.map(l => `<option value="${l.id}" data-short="${l.short_term_only || 0}">${l.id}${l.size_restriction ? ' (' + l.size_restriction + ')' : ''}${l.short_term_only ? ' ⏱️' : ''}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Rate Type</label>
            <select name="rent_type" id="checkin-rent-type" onchange="updateRateLabel(this)">
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
          <div class="form-group"><label>Deposit Paid ($)</label><input name="deposit_amount" id="checkin-deposit-amt" type="number" step="0.01" value="0"></div>
          <div class="form-group" style="display:flex;align-items:flex-end">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem">
              <input type="checkbox" name="deposit_waived" id="checkin-deposit-waived" value="1"> Waive Deposit
            </label>
          </div>
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
        <div id="short-term-info" style="display:none;background:#e0f2fe;border:1px solid #7dd3fc;border-radius:8px;padding:0.65rem 0.75rem;margin-bottom:0.5rem;font-size:0.82rem;color:#0c4a6e">
          <strong>⏱️ Short Term / Overflow Lot</strong><br>
          Daily ($30) and Weekly ($150) — no approval needed<br>
          Monthly rate — requires manager approval<br>
          Max recommended stay: 30 days
        </div>
        <div id="short-term-monthly-warn" style="display:none;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:0.5rem 0.75rem;margin-bottom:0.5rem;font-size:0.82rem;color:#92400e">
          ⚠️ Monthly rate on a short-term lot requires manager approval
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

      <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
        <legend><strong>📄 Documents (optional)</strong></legend>
        <p style="font-size:0.82rem;color:var(--gray-500);margin-bottom:0.75rem">Tap to open your camera and scan. Documents stored securely. Add more anytime from Documents page.</p>
        <div class="doc-scan-grid">
          <label class="doc-scan-btn" id="scan-id"><input type="file" accept="image/*" capture="environment" style="display:none" name="doc_id_file"><span class="doc-scan-icon">🪪</span><span class="doc-scan-label">Scan Photo ID</span><span class="doc-scan-status"></span></label>
          <label class="doc-scan-btn" id="scan-vehicle"><input type="file" accept="image/*" capture="environment" style="display:none" name="doc_vehicle_file"><span class="doc-scan-icon">🚗</span><span class="doc-scan-label">Scan Vehicle Reg</span><span class="doc-scan-status"></span></label>
          <label class="doc-scan-btn" id="scan-insurance"><input type="file" accept="image/*" capture="environment" style="display:none" name="doc_insurance_file"><span class="doc-scan-icon">🛡️</span><span class="doc-scan-label">Scan Insurance</span><span class="doc-scan-status"></span></label>
          <label class="doc-scan-btn" id="scan-other"><input type="file" accept="image/*,.pdf" style="display:none" name="doc_other_file"><span class="doc-scan-icon">📁</span><span class="doc-scan-label">Upload File</span><span class="doc-scan-status"></span></label>
        </div>
        <div id="checkin-doc-previews" class="doc-preview-grid"></div>
      </fieldset>

      <div class="form-group"><label>Notes</label><textarea name="notes"></textarea></div>

      <details style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
        <summary style="cursor:pointer;font-weight:700;font-size:0.92rem;user-select:none;list-style:none;display:flex;align-items:center;gap:0.4rem">
          <span>💰 Collect Payment</span>
          <span style="font-size:0.75rem;font-weight:400;color:var(--gray-500);margin-left:0.25rem">(optional)</span>
        </summary>
        <div style="margin-top:0.75rem">
          <div class="form-row">
            <div class="form-group">
              <label>Amount ($)</label>
              <input name="payment_amount" type="number" step="0.01" min="0" placeholder="0.00">
            </div>
            <div class="form-group">
              <label>Payment Method</label>
              <select name="payment_method" id="checkin-payment-method" onchange="toggleCheckinPaymentNote(this.value)">
                <option value="">— Skip —</option>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="money_order">Money Order</option>
                <option value="card">Credit/Debit Card (Stripe)</option>
              </select>
            </div>
          </div>
          <div class="form-group" id="checkin-payment-ref-group" style="display:none">
            <label>Reference # (optional)</label>
            <input name="payment_reference" placeholder="Check number, receipt number, etc.">
          </div>
          <div id="checkin-payment-card-note" style="display:none;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:0.6rem 0.75rem;font-size:0.82rem;color:#1e40af">
            💳 Card payment will open Stripe checkout after check-in is complete. A 3% convenience fee applies.
          </div>
        </div>
      </details>

      <button type="submit" class="btn btn-success btn-full mt-2">Check In</button>
      <p id="checkin-error" class="error-text" style="display:none"></p>
    </form>
  `);
  // Wire lot select to show short-term info
  setTimeout(function() {
    var lotSel = document.getElementById('checkin-lot-select');
    var rentSel = document.getElementById('checkin-rent-type');
    function checkShortTerm() {
      var opt = lotSel && lotSel.selectedOptions[0];
      var isShort = opt && opt.dataset.short === '1';
      var isMonthly = rentSel && rentSel.value === 'monthly';
      var infoEl = document.getElementById('short-term-info');
      var warnEl = document.getElementById('short-term-monthly-warn');
      if (infoEl) infoEl.style.display = isShort ? '' : 'none';
      if (warnEl) warnEl.style.display = (isShort && isMonthly) ? '' : 'none';
    }
    if (lotSel) lotSel.addEventListener('change', checkShortTerm);
    if (rentSel) rentSel.addEventListener('change', checkShortTerm);
    // Waive deposit toggle
    var waiveCb = document.getElementById('checkin-deposit-waived');
    var depAmt = document.getElementById('checkin-deposit-amt');
    if (waiveCb && depAmt) {
      waiveCb.addEventListener('change', function() {
        depAmt.disabled = this.checked;
        if (this.checked) depAmt.value = '0';
      });
    }
    // Document scan: compress + preview
    document.querySelectorAll('.doc-scan-btn input[type="file"]').forEach(function(input) {
      input.addEventListener('change', function() {
        var file = this.files && this.files[0];
        var btn = this.closest('.doc-scan-btn');
        var statusEl = btn && btn.querySelector('.doc-scan-status');
        var previewsEl = document.getElementById('checkin-doc-previews');
        if (!file || !btn) return;

        // Show scanning state
        if (statusEl) statusEl.textContent = '📸 Processing...';
        btn.style.borderColor = '#f59e0b';

        // Compress image via canvas
        var reader = new FileReader();
        reader.onload = function(e) {
          if (file.type === 'application/pdf') {
            // PDFs: no compression, just mark done
            if (statusEl) statusEl.innerHTML = '✅ Saved';
            btn.style.borderColor = '#16a34a';
            btn.style.background = '#f0fdf4';
            return;
          }
          var img = new Image();
          img.onload = function() {
            var canvas = document.createElement('canvas');
            var maxW = 1200;
            var scale = Math.min(1, maxW / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            var sizeKB = Math.round(dataUrl.length * 0.75 / 1024);

            // Replace file input's data with compressed version
            input._compressedBase64 = dataUrl.split(',')[1];

            // Update button state
            if (statusEl) statusEl.innerHTML = '✅ ' + sizeKB + 'KB';
            btn.style.borderColor = '#16a34a';
            btn.style.background = '#f0fdf4';

            // Show thumbnail preview
            if (previewsEl) {
              var div = document.createElement('div');
              div.className = 'doc-preview-item';
              div.innerHTML = '<img src="' + dataUrl + '" style="width:60px;height:60px;object-fit:cover;border-radius:6px;border:2px solid #16a34a"><div style="font-size:0.65rem;color:#16a34a;text-align:center">✅</div>';
              previewsEl.appendChild(div);
            }
          };
          img.onerror = function() {
            if (statusEl) statusEl.innerHTML = '❌ Failed';
            btn.style.borderColor = '#dc2626';
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });
    });
  }, 50);
}

// Upload documents after check-in
async function uploadCheckinDocs(tenantId, lotId) {
  var docTypes = { doc_id_file: 'id', doc_vehicle_file: 'vehicle', doc_insurance_file: 'insurance', doc_other_file: 'other' };
  var docNames = { id: 'Photo ID', vehicle: 'Vehicle Registration', insurance: 'RV Insurance', other: 'Other Document' };
  for (var name in docTypes) {
    var input = document.querySelector('[name="' + name + '"]');
    if (!input || !input.files || !input.files[0]) continue;
    try {
      // Use pre-compressed data if available, otherwise read raw
      var base64 = input._compressedBase64;
      var fileType = 'image/jpeg';
      if (!base64) {
        var file = input.files[0];
        fileType = file.type;
        base64 = await new Promise(function(resolve) {
          var reader = new FileReader();
          reader.onload = function() { resolve(reader.result.split(',')[1]); };
          reader.readAsDataURL(file);
        });
      }
      await API.post('/documents', {
        tenant_id: tenantId,
        lot_id: lotId,
        doc_type: docTypes[name],
        doc_name: docNames[docTypes[name]] + ' - ' + new Date().toISOString().split('T')[0],
        file_data: base64,
        file_type: fileType,
      });
    } catch (e) { console.error('Doc upload failed:', name, e); }
  }
}

function updateRateLabel(sel) {
  const label = document.getElementById('rate-label');
  const input = sel.form.monthly_rent;
  const type = sel.value;
  if (type === 'daily') { if (label) label.textContent = 'Daily Rate ($)'; if (input && input.value === '295') input.value = '30'; }
  else if (type === 'weekly') { if (label) label.textContent = 'Weekly Rate ($)'; if (input && input.value === '295') input.value = '150'; }
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
      deposit_waived: data.deposit_waived === '1' ? 1 : 0,
      flat_rate: data.flat_rate === '1' ? 1 : 0,
      flat_rate_amount: parseFloat(data.flat_rate_amount) || 0,
    });
    if (!tenant?.id) throw new Error('Tenant was not created — no ID returned');
    // Upload scanned documents if any
    uploadCheckinDocs(tenant.id, data.lot_id);
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
  var generatedInvoiceId = null;
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
      var invResult = await API.post('/invoices', {
        tenant_id: tenant.id,
        invoice_date: data.check_in_date,
        due_date: data.check_in_date,
        billing_period_start: data.check_in_date,
        billing_period_end: endDate,
        rent_amount: prorated,
        notes: `Prorated - ${moName} ${yr} (${remaining}/${dim} days)`,
      });
      generatedInvoiceId = invResult?.id || null;
      console.log(`Prorated invoice created: $${prorated} for ${remaining} days, id=${generatedInvoiceId}`);
    } catch (err) {
      console.error('Prorated invoice failed (non-fatal):', err);
    }
  }

  // === COLLECT PAYMENT (if requested) ===
  var paymentAmount = parseFloat(data.payment_amount) || 0;
  var paymentMethod = data.payment_method || '';

  if (paymentAmount > 0 && paymentMethod && paymentMethod !== 'card') {
    // Cash / Check / Money Order — record directly
    try {
      await API.post('/payments', {
        tenant_id: tenant.id,
        invoice_id: generatedInvoiceId || null,
        payment_date: data.check_in_date || new Date().toISOString().split('T')[0],
        amount: paymentAmount,
        payment_method: paymentMethod,
        reference_number: data.payment_reference || null,
        notes: 'Collected at check-in',
      });
      if (typeof showStatusToast === 'function') showStatusToast('✅', 'Payment of $' + paymentAmount.toFixed(2) + ' recorded');
    } catch (err) {
      console.error('Check-in payment failed (non-fatal):', err);
      if (typeof showStatusToast === 'function') showStatusToast('⚠️', 'Check-in complete but payment failed to save — record it on the Payments page');
    }
  }

  // Card via Stripe — redirect AFTER check-in is complete (non-blocking)
  var stripeRedirectPending = false;
  if (paymentAmount > 0 && paymentMethod === 'card') {
    if (generatedInvoiceId) {
      stripeRedirectPending = true;
    } else {
      if (typeof showStatusToast === 'function') showStatusToast('ℹ️', 'No invoice generated yet — collect card payment from the Payments page');
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

  // Stripe card redirect — fires AFTER check-in is fully complete
  if (stripeRedirectPending && generatedInvoiceId) {
    setTimeout(async function() {
      try {
        var session = await API.post('/payments/create-checkout-session', { invoice_id: generatedInvoiceId });
        if (session?.url) {
          if (typeof showStatusToast === 'function') showStatusToast('💳', 'Redirecting to Stripe for card payment...');
          setTimeout(function() { window.location.href = session.url; }, 1500);
        }
      } catch (err) {
        console.error('Stripe session failed (non-fatal):', err);
        if (typeof showStatusToast === 'function') showStatusToast('⚠️', 'Check-in complete! Card payment can be collected later from the Payments page.');
      }
    }, 4000);
  }
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
let _checkoutData = null;
let _checkoutOtherCharges = [];

async function showCheckOut() {
  _checkoutTenants = await API.get('/tenants');
  _checkoutData = null;
  _checkoutOtherCharges = [];
  showModal('Check-Out Tenant', `
    <form id="checkout-form">
      <div class="form-group">
        <label>Select Tenant</label>
        <select name="tenant_select" id="checkout-tenant-select" required>
          <option value="">Select tenant...</option>
          ${_checkoutTenants.map(t => `<option value="${t.id}|${t.lot_id}">${t.lot_id} - ${t.first_name} ${t.last_name}</option>`).join('')}
        </select>
        <input type="hidden" name="tenant_id">
        <input type="hidden" name="lot_id">
      </div>
      <div class="form-group"><label>Check-Out Date</label><input name="check_out_date" id="checkout-date-input" type="date" value="${new Date().toISOString().split('T')[0]}" required></div>

      <div id="checkout-settlement-body" style="display:none"></div>

      <p id="checkout-error" class="error-text" style="display:none"></p>
    </form>
  `);
  setTimeout(function() {
    var sel = document.getElementById('checkout-tenant-select');
    if (sel) sel.addEventListener('change', function() { checkoutSelected(this); });
    var dateInput = document.getElementById('checkout-date-input');
    if (dateInput) dateInput.addEventListener('change', function() { if (_checkoutData) recalcSettlement(); });
    var form = document.getElementById('checkout-form');
    if (form) form.addEventListener('submit', function(e) { processCheckOut(e); });
  }, 50);
}

async function checkoutSelected(sel) {
  var parts = sel.value.split('|');
  var tid = parts[0], lid = parts[1];
  sel.form.tenant_id.value = tid;
  sel.form.lot_id.value = lid;
  _checkoutOtherCharges = [];

  try {
    _checkoutData = await API.get('/checkins/checkout-data/' + tid);
  } catch (e) { console.error('[checkout] failed to load data:', e); return; }

  var d = _checkoutData;
  var t = d.tenant;
  var rent = Number(t.flat_rate && t.flat_rate_amount > 0 ? t.flat_rate_amount : t.monthly_rent) || 0;
  var deposit = Number(t.deposit_amount) || 0;
  var credit = Number(t.credit_balance) || 0;
  var lastReading = d.lastReading;
  var inv = d.currentInvoice;
  var rentPaid = inv ? Number(inv.amount_paid) : 0;
  var coDate = document.getElementById('checkout-date-input').value;
  var coDay = parseInt(coDate.split('-')[2]) || 1;
  var coYear = parseInt(coDate.split('-')[0]);
  var coMonth = parseInt(coDate.split('-')[1]);
  var daysInMonth = new Date(coYear, coMonth, 0).getDate();

  var body = document.getElementById('checkout-settlement-body');
  body.style.display = '';
  body.innerHTML = `
    <!-- RENT -->
    <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
      <legend><strong>Move-Out Settlement</strong></legend>
      <div style="font-size:0.9rem;margin-bottom:0.5rem">
        <div><strong>Monthly rate:</strong> ${formatMoney(rent)}</div>
        <div><strong>Already paid this month:</strong> ${formatMoney(rentPaid)}</div>
      </div>
      <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;padding:0.4rem 0;font-size:0.9rem">
        <input type="checkbox" id="prorate-checkbox" name="prorate_rent" value="1"> Prorate rent for early move-out
      </label>
      <div id="prorate-details" style="display:none;margin-top:0.5rem;padding:0.5rem 0.75rem;background:#f8fafc;border:1px solid var(--gray-200);border-radius:6px;font-size:0.85rem">
        <div class="form-row" style="gap:0.5rem">
          <div class="form-group" style="flex:1">
            <label>Days in month</label>
            <input id="prorate-days-month" type="number" value="${daysInMonth}" readonly style="background:#f3f4f6">
          </div>
          <div class="form-group" style="flex:1">
            <label>Days occupied</label>
            <input id="prorate-days-occupied" type="number" min="0" max="${daysInMonth}" value="${Math.max(0, coDay - 1)}" inputmode="numeric">
          </div>
        </div>
        <div id="prorate-calc" style="margin-top:0.25rem;font-size:0.85rem"></div>
      </div>
      <div id="no-prorate-info" style="margin-top:0.25rem;font-size:0.82rem;color:var(--gray-500)">
        No rent proration. Park keeps full ${formatMoney(rent)}.
      </div>
    </fieldset>

    <!-- ELECTRIC -->
    <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
      <legend><strong>Final Electric Reading</strong></legend>
      <div class="form-row" style="gap:0.5rem">
        <div class="form-group" style="flex:1">
          <label>Previous reading</label>
          <input id="electric-prev" type="number" value="${lastReading ? lastReading.current_reading : 0}" readonly style="background:#f3f4f6">
        </div>
        <div class="form-group" style="flex:1">
          <label>Current reading</label>
          <input id="electric-current" type="number" inputmode="numeric" placeholder="Enter final reading">
        </div>
      </div>
      <div id="electric-calc" style="font-size:0.85rem;margin-top:0.25rem"></div>
    </fieldset>

    <!-- DEPOSIT -->
    <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
      <legend><strong>Deposit Settlement</strong></legend>
      ${t.deposit_waived ? '<div style="font-size:0.85rem;color:var(--gray-500)">Deposit was waived — nothing to settle.</div>' :
        deposit > 0 ? `
        <div style="font-size:0.9rem;margin-bottom:0.5rem"><strong>Deposit on file:</strong> <span style="color:#16a34a;font-weight:700">${formatMoney(deposit)}</span></div>
        <div class="form-group">
          <label>Disposition</label>
          <select id="deposit-action-select" name="deposit_action">
            <option value="full_refund">Full Refund — return ${formatMoney(deposit)}</option>
            <option value="partial">Partial Refund — deduct damages/cleaning</option>
            <option value="forfeit">Forfeit — tenant loses deposit</option>
          </select>
        </div>
        <div id="deposit-partial-row" style="display:none">
          <div class="form-row" style="gap:0.5rem">
            <div class="form-group" style="flex:1"><label>Deduction ($)</label><input id="deposit-deduction-input" type="number" step="0.01" min="0" max="${deposit}" value="0" inputmode="decimal"></div>
            <div class="form-group" style="flex:1"><label>Reason</label><input id="deposit-deduction-reason" placeholder="e.g. cleaning, damage"></div>
          </div>
          <div id="deposit-refund-calc" style="font-size:0.85rem;color:#16a34a;margin-top:0.25rem">Refund: <strong>${formatMoney(deposit)}</strong></div>
        </div>
      ` : '<div style="font-size:0.85rem;color:var(--gray-500)">No deposit on file.</div>'}
    </fieldset>

    <!-- OTHER CHARGES -->
    <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
      <legend><strong>Other Charges</strong> <span style="font-weight:400;color:var(--gray-400);font-size:0.8rem">(optional)</span></legend>
      <div id="other-charges-list"></div>
      <button type="button" class="btn btn-sm btn-outline" onclick="addCheckoutCharge()" style="margin-top:0.25rem">+ Add Charge</button>
    </fieldset>

    <!-- SETTLEMENT SUMMARY -->
    <fieldset style="border:2px solid var(--gray-900);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px;background:#fafafa">
      <legend><strong>Final Settlement</strong></legend>
      <div id="settlement-summary" style="font-size:0.9rem"></div>
    </fieldset>

    <!-- REFUND/PAYMENT METHOD -->
    <fieldset style="border:1px solid var(--gray-200);padding:0.75rem;margin-bottom:0.75rem;border-radius:8px">
      <legend><strong>Refund / Payment Method</strong></legend>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem">
        ${['Cash','Check','Mailed Check','Zelle','Credit Card','Other'].map(function(m) {
          return '<label style="display:flex;align-items:center;gap:0.35rem;padding:0.5rem 0.75rem;border:1px solid var(--gray-300);border-radius:8px;cursor:pointer;min-height:48px;font-size:0.9rem">' +
            '<input type="radio" name="settlement_method" value="' + m + '"' + (m === 'Cash' ? ' checked' : '') + '> ' + m + '</label>';
        }).join('')}
      </div>
      <div class="form-group" style="margin-top:0.5rem">
        <label>Reference # <span style="font-weight:400;color:var(--gray-400)">(optional)</span></label>
        <input name="settlement_reference" placeholder="Check number, etc.">
      </div>
    </fieldset>

    <div class="form-group"><label>Notes</label><textarea name="notes" placeholder="Any additional notes about this checkout..."></textarea></div>

    <div style="position:sticky;bottom:0;background:#fff;padding:0.5rem 0;z-index:10">
      <div class="btn-group" style="gap:0.5rem">
        <button type="button" class="btn btn-outline" onclick="printMoveOutPreview()" style="min-height:48px;flex:1">Print Statement</button>
        <button type="submit" class="btn btn-warning" style="min-height:48px;flex:2;font-size:1rem">Check Out & Settle</button>
      </div>
    </div>
  `;

  // Wire all events
  setTimeout(function() {
    var prorateCb = document.getElementById('prorate-checkbox');
    if (prorateCb) prorateCb.addEventListener('change', function() {
      document.getElementById('prorate-details').style.display = this.checked ? '' : 'none';
      document.getElementById('no-prorate-info').style.display = this.checked ? 'none' : '';
      recalcSettlement();
    });
    var daysOcc = document.getElementById('prorate-days-occupied');
    if (daysOcc) daysOcc.addEventListener('input', recalcSettlement);
    var elCur = document.getElementById('electric-current');
    if (elCur) elCur.addEventListener('input', recalcSettlement);
    var depAction = document.getElementById('deposit-action-select');
    if (depAction) depAction.addEventListener('change', function() {
      var partial = document.getElementById('deposit-partial-row');
      if (partial) partial.style.display = this.value === 'partial' ? '' : 'none';
      recalcSettlement();
    });
    var depDed = document.getElementById('deposit-deduction-input');
    if (depDed) depDed.addEventListener('input', function() {
      var dep = Number(_checkoutData.tenant.deposit_amount) || 0;
      var ded = Math.min(Math.max(parseFloat(this.value) || 0, 0), dep);
      var calc = document.getElementById('deposit-refund-calc');
      if (calc) calc.innerHTML = 'Refund: <strong>' + formatMoney(dep - ded) + '</strong>';
      recalcSettlement();
    });
    recalcSettlement();
  }, 50);
}

function addCheckoutCharge() {
  var idx = _checkoutOtherCharges.length;
  _checkoutOtherCharges.push({ description: '', amount: 0 });
  var list = document.getElementById('other-charges-list');
  if (!list) return;
  var row = document.createElement('div');
  row.className = 'form-row';
  row.style.cssText = 'gap:0.5rem;margin-bottom:0.25rem';
  row.id = 'other-charge-' + idx;
  row.innerHTML = '<div class="form-group" style="flex:2"><input placeholder="Description (e.g. cleaning fee)" data-charge-idx="' + idx + '" data-field="description"></div>' +
    '<div class="form-group" style="flex:1"><input type="number" step="0.01" min="0" inputmode="decimal" placeholder="$0.00" data-charge-idx="' + idx + '" data-field="amount"></div>' +
    '<button type="button" style="align-self:center;background:none;border:none;color:#dc2626;cursor:pointer;font-size:1.2rem;padding:0.25rem" onclick="removeCheckoutCharge(' + idx + ')">x</button>';
  list.appendChild(row);
  row.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('input', function() {
      var i = parseInt(this.dataset.chargeIdx);
      var f = this.dataset.field;
      _checkoutOtherCharges[i][f] = f === 'amount' ? (parseFloat(this.value) || 0) : this.value;
      recalcSettlement();
    });
  });
}

function removeCheckoutCharge(idx) {
  _checkoutOtherCharges[idx] = null;
  var el = document.getElementById('other-charge-' + idx);
  if (el) el.remove();
  recalcSettlement();
}

function recalcSettlement() {
  if (!_checkoutData) return;
  var d = _checkoutData;
  var t = d.tenant;
  var rent = Number(t.flat_rate && t.flat_rate_amount > 0 ? t.flat_rate_amount : t.monthly_rent) || 0;
  var deposit = Number(t.deposit_amount) || 0;
  var credit = Number(t.credit_balance) || 0;

  // Rent proration
  var rentRefund = 0;
  var prorateCb = document.getElementById('prorate-checkbox');
  if (prorateCb && prorateCb.checked) {
    var daysMonth = parseInt(document.getElementById('prorate-days-month').value) || 30;
    var daysOcc = parseInt(document.getElementById('prorate-days-occupied').value) || 0;
    var dailyRate = +(rent / daysMonth).toFixed(2);
    var proratedRent = +(dailyRate * daysOcc).toFixed(2);
    rentRefund = +(rent - proratedRent).toFixed(2);
    if (rentRefund < 0) rentRefund = 0;
    var pCalc = document.getElementById('prorate-calc');
    if (pCalc) pCalc.innerHTML = 'Daily rate: <strong>' + formatMoney(dailyRate) + '</strong> x ' + daysOcc + ' days = <strong>' + formatMoney(proratedRent) + '</strong><br>Rent refund: <strong style="color:#16a34a">' + formatMoney(rentRefund) + '</strong>';
  }

  // Electric
  var electricCharge = 0;
  var elPrevVal = document.getElementById('electric-prev').value?.trim();
  var elCurVal = document.getElementById('electric-current').value?.trim();
  var elPrev = elPrevVal !== '' && elPrevVal != null ? parseFloat(elPrevVal) : null;
  var elCur = elCurVal !== '' && elCurVal != null ? parseFloat(elCurVal) : null;
  var elRate = d.electricRate || 0.15;
  if (elCur != null && elPrev != null && elCur >= elPrev) {
    var kwh = elCur - elPrev;
    electricCharge = +(kwh * elRate).toFixed(2);
    var eCalc = document.getElementById('electric-calc');
    if (eCalc) eCalc.innerHTML = 'kWh used: <strong>' + kwh + '</strong> x $' + elRate.toFixed(2) + '/kWh = <strong style="color:#dc2626">' + formatMoney(electricCharge) + '</strong>';
  } else {
    var eCalc = document.getElementById('electric-calc');
    if (eCalc) eCalc.innerHTML = elCur != null && elPrev != null && elCur < elPrev ? '<span style="color:#dc2626">Current reading must be >= previous</span>' : '';
  }

  // Deposit
  var depositRefund = 0;
  var depAction = document.getElementById('deposit-action-select');
  if (depAction && deposit > 0) {
    if (depAction.value === 'full_refund') depositRefund = deposit;
    else if (depAction.value === 'partial') {
      var ded = parseFloat(document.getElementById('deposit-deduction-input').value) || 0;
      depositRefund = +(deposit - Math.min(ded, deposit)).toFixed(2);
    } else depositRefund = 0;
  }

  // Other charges
  var otherTotal = 0;
  _checkoutOtherCharges.forEach(function(c) { if (c) otherTotal += Number(c.amount) || 0; });
  otherTotal = +otherTotal.toFixed(2);

  // NET
  var net = +(rentRefund + depositRefund + credit - electricCharge - otherTotal).toFixed(2);

  var summary = document.getElementById('settlement-summary');
  if (!summary) return;
  var lines = [];
  lines.push(sLine('Rent refund', rentRefund, rentRefund > 0));
  lines.push(sLine('Electric charge', -electricCharge, false));
  lines.push(sLine('Deposit refund', depositRefund, depositRefund > 0));
  if (otherTotal > 0) lines.push(sLine('Other charges', -otherTotal, false));
  if (credit > 0) lines.push(sLine('Existing credit', credit, true));
  lines.push('<tr style="border-top:2px solid var(--gray-900)"><td style="padding:0.5rem 0;font-weight:700;font-size:1.05rem">' +
    (net >= 0 ? 'NET DUE TO GUEST' : 'NET DUE FROM GUEST') +
    '</td><td style="padding:0.5rem 0;text-align:right;font-weight:700;font-size:1.1rem;color:' + (net >= 0 ? '#16a34a' : '#dc2626') + '">' +
    (net >= 0 ? '+' : '') + formatMoney(Math.abs(net)) + '</td></tr>');
  summary.innerHTML = '<table style="width:100%;border-collapse:collapse">' + lines.join('') + '</table>';
}

function sLine(label, amount, positive) {
  var color = amount === 0 ? 'var(--gray-400)' : (positive ? '#16a34a' : '#dc2626');
  var prefix = amount > 0 ? '+' : amount < 0 ? '' : '';
  return '<tr style="border-bottom:1px solid var(--gray-200)"><td style="padding:0.3rem 0">' + label + '</td><td style="padding:0.3rem 0;text-align:right;font-weight:600;color:' + color + '">' + prefix + formatMoney(Math.abs(amount)) + (amount < 0 ? ' (charge)' : '') + '</td></tr>';
}

function renderMoveOutStatementHtml(s) {
  var fmtNum = function(v) { return Number(v || 0).toLocaleString(); };
  var amtCell = function(amount, positive) {
    var color = amount === 0 ? '#9ca3af' : (positive ? '#16a34a' : '#dc2626');
    var prefix = positive && amount > 0 ? '+' : (amount < 0 ? '\u2212' : '');
    return '<td class="text-right" style="color:' + color + '">' + prefix + formatMoney(Math.abs(amount)) + '</td>';
  };
  var depLabel = s.deposit_action === 'forfeit' ? 'Forfeited' : s.deposit_action === 'partial' ? 'Partial Refund' : 'Full Refund';

  return '<div class="invoice-print" id="printable-moveout">' +
    '<div class="invoice-header">' +
      '<div style="display:flex;align-items:center;gap:1rem">' +
        '<img src="/park_Logo.png" alt="Anahuac RV Park" style="height:70px;width:auto" crossorigin="anonymous">' +
        '<div>' +
          '<h2 style="color:#166534">Anahuac RV Park, LLC</h2>' +
          '<p>1003 Davis Ave, Anahuac, TX 77514</p>' +
          '<p>(409) 267-6603 &bull; anrvpark@gmail.com</p>' +
        '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<h3 style="color:#166534;font-size:1rem">MOVE-OUT<br>SETTLEMENT</h3>' +
        '<p><strong>' + escapeHtml(s.statement_number || '') + '</strong></p>' +
        '<p>Date: ' + formatDate(s.statement_date || s.checkout_date) + '</p>' +
      '</div>' +
    '</div>' +

    '<div style="display:grid;grid-template-columns:auto 1fr;gap:0.15rem 1rem;font-size:0.82rem;margin-bottom:1rem">' +
      '<strong>Guest Name:</strong><span>' + escapeHtml(s.tenant_name) + '</span>' +
      '<strong>Lot:</strong><span>' + escapeHtml(s.lot_id) + '</span>' +
      (s.move_in_date ? '<strong>Move-In Date:</strong><span>' + formatDate(s.move_in_date) + '</span>' : '') +
      '<strong>Move-Out Date:</strong><span>' + formatDate(s.checkout_date) + '</span>' +
    '</div>' +

    '<div class="line-items">' +
      '<table>' +
        '<thead><tr><th style="text-align:left;color:#166534">Description</th><th class="text-right" style="color:#166534">Amount</th></tr></thead>' +
        '<tbody>' +
          '<tr><td colspan="2" style="background:#f0fdf4;font-weight:700;color:#166534;padding:0.4rem 0.5rem">RENT SETTLEMENT</td></tr>' +
          '<tr><td>&nbsp;&nbsp;Monthly Rate</td><td class="text-right">' + formatMoney(s.monthly_rent) + '</td></tr>' +
          (s.prorate_rent ?
            '<tr><td>&nbsp;&nbsp;Days Occupied</td><td class="text-right">' + s.days_occupied + ' of ' + s.days_in_month + ' days</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Prorated Rent Owed</td><td class="text-right">' + formatMoney(s.prorated_rent) + '</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Rent Refund</td>' + amtCell(s.rent_refund, true) + '</tr>'
          :
            '<tr><td>&nbsp;&nbsp;Prorated Days Used</td><td class="text-right" style="color:#9ca3af">n/a</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Rent Refund</td><td class="text-right" style="color:#9ca3af">$0.00</td></tr>'
          ) +

          (s.electric_current != null ?
            '<tr><td colspan="2" style="background:#f0fdf4;font-weight:700;color:#166534;padding:0.4rem 0.5rem">FINAL ELECTRIC USAGE</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Previous Reading</td><td class="text-right">' + fmtNum(s.electric_previous) + '</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Final Reading</td><td class="text-right">' + fmtNum(s.electric_current) + '</td></tr>' +
            '<tr><td>&nbsp;&nbsp;kWh Used</td><td class="text-right">' + fmtNum(s.electric_kwh) + '</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Rate per kWh</td><td class="text-right">$' + Number(s.electric_rate).toFixed(3) + '</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Electric Charge</td>' + amtCell(-s.electric_charge, false) + '</tr>'
          : '') +

          (s.deposit > 0 ?
            '<tr><td colspan="2" style="background:#f0fdf4;font-weight:700;color:#166534;padding:0.4rem 0.5rem">DEPOSIT</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Deposit on File</td><td class="text-right">' + formatMoney(s.deposit) + '</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Disposition</td><td class="text-right">' + depLabel + (s.deposit_deduction > 0 ? ' (' + escapeHtml(s.deposit_deduction_reason || 'deductions') + ': ' + formatMoney(s.deposit_deduction) + ')' : '') + '</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Deposit Refund</td>' + amtCell(s.deposit_refund, true) + '</tr>'
          : '') +

          (s.other_total > 0 ?
            '<tr><td colspan="2" style="background:#f0fdf4;font-weight:700;color:#166534;padding:0.4rem 0.5rem">OTHER CHARGES</td></tr>' +
            (s.other_charges || []).map(function(c) {
              return '<tr><td>&nbsp;&nbsp;' + escapeHtml(c.description || 'Charge') + '</td>' + amtCell(-Number(c.amount), false) + '</tr>';
            }).join('')
          : '') +

          (s.credit_applied > 0 ?
            '<tr><td colspan="2" style="background:#f0fdf4;font-weight:700;color:#166534;padding:0.4rem 0.5rem">ACCOUNT CREDIT</td></tr>' +
            '<tr><td>&nbsp;&nbsp;Credit Applied</td>' + amtCell(s.credit_applied, true) + '</tr>'
          : '') +

          '<tr class="total-row"><td style="font-size:1rem;padding:0.5rem 0.5rem">' + (s.net_settlement >= 0 ? 'NET DUE TO GUEST' : 'NET DUE FROM GUEST') + '</td>' +
            '<td class="text-right" style="font-size:1.1rem;padding:0.5rem 0.5rem;color:' + (s.net_settlement >= 0 ? '#16a34a' : '#dc2626') + '">' +
            (s.net_settlement >= 0 ? '+' : '\u2212') + formatMoney(Math.abs(s.net_settlement)) + '</td></tr>' +
        '</tbody>' +
      '</table>' +
    '</div>' +

    (s.settlement_method ? '<div style="margin-top:0.75rem;padding:0.6rem 0.75rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:0.88rem">' +
      '<strong>Final Payment Recorded:</strong> ' + escapeHtml(s.settlement_method) +
      ' &mdash; ' + (s.net_settlement >= 0 ? '+' : '') + formatMoney(Math.abs(s.net_settlement)) +
      ' ' + (s.net_settlement >= 0 ? '(refunded to guest)' : '(collected from guest)') +
      (s.settlement_reference ? ' &bull; Ref: ' + escapeHtml(s.settlement_reference) : '') +
    '</div>' : '') +

    '<div style="margin-top:2rem;font-size:0.82rem">' +
      '<div style="display:flex;gap:2rem;margin-bottom:1.5rem">' +
        '<div style="flex:1"><p style="margin-bottom:0.75rem">Guest Signature:</p><div style="border-bottom:1px dotted #374151;height:1.5rem"></div></div>' +
        '<div style="width:120px"><p style="margin-bottom:0.75rem">Date:</p><div style="border-bottom:1px dotted #374151;height:1.5rem"></div></div>' +
      '</div>' +
      '<div style="display:flex;gap:2rem">' +
        '<div style="flex:1"><p style="margin-bottom:0.75rem">Admin Signature:</p><div style="border-bottom:1px dotted #374151;height:1.5rem"></div></div>' +
        '<div style="width:120px"><p style="margin-bottom:0.75rem">Date:</p><div style="border-bottom:1px dotted #374151;height:1.5rem"></div></div>' +
      '</div>' +
    '</div>' +

    '<div style="margin-top:1.5rem;padding-top:0.75rem;border-top:1px solid #ccc;text-align:center;font-size:0.78rem;color:#374151;line-height:1.5">' +
      '<p style="margin:0.2rem 0">Thank you for staying at Anahuac RV Park!</p>' +
      '<p style="margin:0.2rem 0;font-style:italic">Welcome back anytime to the Gator Capital of Texas!</p>' +
      '<p style="margin:0.5rem 0 0;font-size:0.72rem;color:#78716c">Anahuac RV Park, LLC &bull; 1003 Davis Ave, Anahuac, TX 77514 &bull; (409) 267-6603 &bull; anrvpark@gmail.com</p>' +
    '</div>' +
  '</div>';
}

function printMoveOutPreview() {
  if (!_checkoutData) return;
  var t = _checkoutData.tenant;
  var d = _checkoutData;
  var rent = Number(t.flat_rate && t.flat_rate_amount > 0 ? t.flat_rate_amount : t.monthly_rent) || 0;
  var deposit = Number(t.deposit_amount) || 0;
  var credit = Number(t.credit_balance) || 0;
  var coDate = document.getElementById('checkout-date-input').value;
  var prorateCb = document.getElementById('prorate-checkbox');
  var elPrev = parseFloat(document.getElementById('electric-prev')?.value) || 0;
  var elCurVal = document.getElementById('electric-current')?.value?.trim();
  var elCur = elCurVal !== '' && elCurVal != null ? parseFloat(elCurVal) : null;
  var hasElectric = elCur !== null && !isNaN(elCur);
  var depAction = document.getElementById('deposit-action-select');

  var daysMonth = parseInt(document.getElementById('prorate-days-month')?.value) || 30;
  var daysOcc = parseInt(document.getElementById('prorate-days-occupied')?.value) || 0;
  var prorateRent = prorateCb && prorateCb.checked;
  var dailyRate = +(rent / daysMonth).toFixed(2);
  var proratedRent = prorateRent ? +(dailyRate * daysOcc).toFixed(2) : rent;
  var rentRefund = prorateRent ? Math.max(0, +(rent - proratedRent).toFixed(2)) : 0;

  var elRate = d.electricRate || 0.15;
  var kwh = hasElectric && elCur >= elPrev ? elCur - elPrev : 0;
  var electricCharge = +(kwh * elRate).toFixed(2);

  var depositRefund = 0;
  var depDed = 0;
  if (depAction && deposit > 0) {
    if (depAction.value === 'full_refund') depositRefund = deposit;
    else if (depAction.value === 'partial') {
      depDed = parseFloat(document.getElementById('deposit-deduction-input')?.value) || 0;
      depositRefund = +(deposit - Math.min(depDed, deposit)).toFixed(2);
    }
  }

  var otherTotal = 0;
  var charges = [];
  _checkoutOtherCharges.forEach(function(c) {
    if (c && c.amount > 0) { otherTotal += Number(c.amount); charges.push(c); }
  });
  otherTotal = +otherTotal.toFixed(2);
  var net = +(rentRefund + depositRefund + credit - electricCharge - otherTotal).toFixed(2);

  var previewData = {
    statement_number: 'PREVIEW',
    tenant_name: t.first_name + ' ' + t.last_name,
    lot_id: t.lot_id,
    move_in_date: t.move_in_date || null,
    checkout_date: coDate,
    statement_date: coDate,
    monthly_rent: rent,
    prorate_rent: prorateRent,
    days_occupied: daysOcc,
    days_in_month: daysMonth,
    prorated_rent: proratedRent,
    rent_refund: rentRefund,
    electric_previous: hasElectric ? elPrev : null,
    electric_current: hasElectric ? elCur : null,
    electric_kwh: kwh,
    electric_rate: elRate,
    electric_charge: electricCharge,
    deposit: deposit,
    deposit_action: depAction ? depAction.value : null,
    deposit_refund: depositRefund,
    deposit_deduction: depDed,
    deposit_deduction_reason: document.getElementById('deposit-deduction-reason')?.value || '',
    other_charges: charges,
    other_total: otherTotal,
    credit_applied: credit,
    net_settlement: net,
    settlement_method: document.querySelector('input[name="settlement_method"]:checked')?.value || 'Cash',
    settlement_reference: document.querySelector('input[name="settlement_reference"]')?.value || '',
  };

  var w = window.open('', '_blank', 'width=700,height=900');
  w.document.write('<!DOCTYPE html><html><head><title>Move-Out Statement — ' + escapeHtml(previewData.tenant_name) + '</title>');
  w.document.write('<style>');
  w.document.write('body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:1.5rem;color:#111827;font-size:13px;line-height:1.4}');
  w.document.write('.invoice-print{max-width:700px;margin:0 auto;font-size:0.82rem;line-height:1.4}');
  w.document.write('.invoice-header{display:flex;justify-content:space-between;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:2px solid #111827}');
  w.document.write('.invoice-header img{max-height:70px;width:auto}');
  w.document.write('h2{font-size:1.1rem;margin:0 0 0.2rem} h3{font-size:1rem;margin:0 0 0.2rem} p{margin:0.15rem 0}');
  w.document.write('.line-items{margin:0.75rem 0} .line-items table{width:100%;border-collapse:collapse;font-size:0.82rem}');
  w.document.write('.line-items th,.line-items td{padding:0.3rem 0.5rem;border-bottom:1px solid #e5e7eb}');
  w.document.write('.text-right{text-align:right}');
  w.document.write('.total-row{font-weight:700;border-top:2px solid #111827!important}');
  w.document.write('.total-row td{border-bottom:2px solid #111827!important}');
  w.document.write('@media print{.no-print{display:none!important} @page{margin:0.5in;size:letter portrait}}');
  w.document.write('</style></head><body>');
  w.document.write(renderMoveOutStatementHtml(previewData));
  w.document.write('<div class="no-print" style="text-align:center;margin-top:1rem"><button onclick="window.print()" style="padding:0.5rem 2rem;font-size:1rem;cursor:pointer;background:#166534;color:#fff;border:none;border-radius:6px">Print Statement</button></div>');
  w.document.write('</body></html>');
  w.document.close();
}

async function processCheckOut(e) {
  e.preventDefault();
  var form = new FormData(e.target);
  var errEl = document.getElementById('checkout-error');
  if (errEl) errEl.style.display = 'none';

  try {
    var d = _checkoutData;
    var t = d ? d.tenant : null;
    var deposit = t ? Number(t.deposit_amount) || 0 : 0;
    var prorateCb = document.getElementById('prorate-checkbox');
    var elPrevEl = document.getElementById('electric-prev');
    var elCurEl = document.getElementById('electric-current');
    var elPrev = parseFloat(elPrevEl?.value) || 0;
    var elCurVal = elCurEl?.value?.trim();
    var elCur = elCurVal !== '' && elCurVal != null ? parseFloat(elCurVal) : null;
    var depAction = document.getElementById('deposit-action-select');

    var charges = _checkoutOtherCharges.filter(function(c) { return c && c.amount > 0; });

    var hasElectric = elCur !== null && !isNaN(elCur);

    var body = {
      tenant_id: parseInt(form.get('tenant_id')),
      lot_id: form.get('lot_id'),
      check_out_date: form.get('check_out_date'),
      notes: form.get('notes') || '',
      prorate_rent: prorateCb && prorateCb.checked,
      days_occupied: prorateCb && prorateCb.checked ? parseInt(document.getElementById('prorate-days-occupied').value) || 0 : null,
      days_in_month: prorateCb && prorateCb.checked ? parseInt(document.getElementById('prorate-days-month').value) || 30 : null,
      electric_previous: hasElectric ? elPrev : null,
      electric_current: hasElectric ? elCur : null,
      electric_rate: d ? d.electricRate : 0.15,
      deposit_action: depAction && deposit > 0 ? depAction.value : null,
      deposit_deduction: depAction && depAction.value === 'partial' ? (parseFloat(document.getElementById('deposit-deduction-input')?.value) || 0) : 0,
      deposit_deduction_reason: document.getElementById('deposit-deduction-reason')?.value || '',
      other_charges: charges,
      settlement_method: form.get('settlement_method') || 'Cash',
      settlement_reference: form.get('settlement_reference') || '',
    };

    var result = await API.post('/checkins/checkout', body);
    closeModal();
    showStatusToast('✅', 'Guest checked out! Settlement recorded.');

    // Show Move-Out Statement
    var s = result.statement;
    if (s) {
      showModal('Move-Out Statement', renderMoveOutStatementHtml(s) +
        '<div class="btn-group no-print" style="justify-content:center;margin-top:1rem">' +
          '<button class="btn btn-outline" onclick="printMoveOutFromModal()">Print</button>' +
          '<button class="btn btn-primary" onclick="closeModal();promptReviewRequest(' + result.tenant_id + ',\'' + escapeHtml(s.tenant_name).replace(/'/g, "\\'") + '\')">Done</button>' +
        '</div>'
      );
    } else {
      promptReviewRequest(result.tenant_id, result.tenant_name || 'this tenant');
    }
  } catch (err) {
    var msg = err.message || 'Check-out failed';
    if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
    else alert('Check-out failed: ' + msg);
  }
}

function printMoveOutFromModal() {
  var el = document.getElementById('printable-moveout');
  if (!el) { window.print(); return; }
  var w = window.open('', '_blank', 'width=700,height=900');
  w.document.write('<!DOCTYPE html><html><head><title>Move-Out Settlement Statement</title>');
  w.document.write('<style>');
  w.document.write('body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:1.5rem;color:#111827;font-size:13px;line-height:1.4}');
  w.document.write('.invoice-print{max-width:700px;margin:0 auto;font-size:0.82rem;line-height:1.4}');
  w.document.write('.invoice-header{display:flex;justify-content:space-between;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:2px solid #111827}');
  w.document.write('.invoice-header img{max-height:70px;width:auto}');
  w.document.write('h2{font-size:1.1rem;margin:0 0 0.2rem} h3{font-size:1rem;margin:0 0 0.2rem} p{margin:0.15rem 0}');
  w.document.write('.line-items{margin:0.75rem 0} .line-items table{width:100%;border-collapse:collapse;font-size:0.82rem}');
  w.document.write('.line-items th,.line-items td{padding:0.3rem 0.5rem;border-bottom:1px solid #e5e7eb}');
  w.document.write('.text-right{text-align:right}');
  w.document.write('.total-row{font-weight:700;border-top:2px solid #111827!important}');
  w.document.write('.total-row td{border-bottom:2px solid #111827!important}');
  w.document.write('@media print{.no-print{display:none!important} @page{margin:0.5in;size:letter portrait}}');
  w.document.write('</style></head><body>');
  w.document.write(el.outerHTML);
  w.document.write('<div class="no-print" style="text-align:center;margin-top:1rem"><button onclick="window.print()" style="padding:0.5rem 2rem;font-size:1rem;cursor:pointer;background:#166534;color:#fff;border:none;border-radius:6px">Print Statement</button></div>');
  w.document.write('</body></html>');
  w.document.close();
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

async function promptReviewRequest(tenantId, tenantName) {
  try {
    const check = await API.get('/reviews/can-send/' + tenantId);
    if (!check.canSend) { loadCheckins(); return; }
  } catch { loadCheckins(); return; }

  showModal('Send a Review Request?', `
    <div style="text-align:center;padding:0.5rem">
      <div style="font-size:2.5rem;margin-bottom:0.5rem">⭐</div>
      <p style="font-size:1rem;margin-bottom:0.5rem">Send a review request to <strong>${escapeHtml(tenantName)}</strong>?</p>
      <p style="font-size:0.85rem;color:var(--gray-500);margin-bottom:1.5rem">A friendly SMS and email will be sent asking them to leave a Google review. This helps us attract new guests!</p>
      <div class="btn-group" style="justify-content:center">
        <button class="btn btn-primary" onclick="sendReviewRequest(${tenantId},'${escapeHtml(tenantName)}')">Send Review Request</button>
        <button class="btn btn-outline" onclick="closeModal();loadCheckins()">Skip</button>
      </div>
    </div>
  `);
}

async function sendReviewRequest(tenantId, tenantName) {
  try {
    const result = await API.post('/reviews/send', { tenant_id: tenantId });
    closeModal();
    if (result.skipped) {
      showStatusToast('ℹ️', 'Review request already sent recently');
    } else {
      showStatusToast('⭐', 'Review request sent to ' + tenantName + ' via ' + (result.method || 'message') + '!');
    }
  } catch (err) {
    closeModal();
    showStatusToast('⚠️', 'Review request failed: ' + (err.message || 'unknown error'));
  }
  loadCheckins();
}

