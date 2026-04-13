/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
async function loadSiteMap() {
  // Cache-bust: force fresh data
  const allLots = await API.get('/lots?_t=' + Date.now());
  if (!allLots) return;

  // Deduplicate by lot id (in case LEFT JOIN produces multiple rows)
  const seen = new Set();
  const lots = allLots.filter(lot => {
    if (seen.has(lot.id)) return false;
    seen.add(lot.id);
    return true;
  });

  const rows = {};
  lots.forEach(lot => {
    if (!rows[lot.row_letter]) rows[lot.row_letter] = [];
    rows[lot.row_letter].push(lot);
  });

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('sitemap')}
    <div class="page-header"><h2>Site Map</h2></div>
    <div class="sitemap-legend">
      <div class="legend-item"><div class="legend-dot" style="background:#f0fdf4;border:2px solid var(--brand-primary, #1a5c32)"></div> Occupied</div>
      <div class="legend-item"><div class="legend-dot" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid var(--success)"></div> Vacant</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--gray-100);border:2px solid var(--gray-500)"></div> Owner Reserved</div>
      <div class="legend-item"><div class="legend-dot" style="background:#fee2e2;border:3px solid #dc2626"></div> Unpaid / Overdue</div>
      <div class="legend-item"><div class="legend-dot" style="background:#fef3c7;border:3px solid #eab308"></div> Partial Payment</div>
    </div>
    ${Object.entries(rows).map(([letter, rowLots]) => `
      <div class="sitemap-row-label">Row ${letter}</div>
      <div class="sitemap-grid">
        ${rowLots.map(lot => {
          const flagClass = lot.payment_flag ? `flag-${lot.payment_flag}` : '';
          const flagBadge = (lot.payment_flag === 'overdue' || lot.payment_flag === 'unpaid')
            ? '<span class="lot-flag-badge red" title="Unpaid balance">!</span>'
            : lot.payment_flag === 'partial'
              ? '<span class="lot-flag-badge yellow" title="Partial payment">!</span>'
              : '';
          const hasOverdue = lot.balance_due > 0 && lot.payment_flag;
          const _isAdmin = API.user?.role === 'admin';
          const glowStyle = (_isAdmin && hasOverdue) ? 'box-shadow:0 0 12px rgba(255,80,80,0.8);' : '';
          return `
          <div class="lot-card ${lot.status} ${_isAdmin ? flagClass : ''}" style="${glowStyle}" onclick="showLotDetail('${lot.id}')">
            ${_isAdmin ? flagBadge : ''}
            <div class="lot-id">${lot.id}</div>
            <div class="lot-tenant">${(lot.status === 'occupied' && lot.tenant_id) ? escapeHtml(lot.first_name + ' ' + lot.last_name) : escapeHtml(lot.notes || (lot.status === 'owner_reserved' ? 'Reserved' : lot.status === 'vacant' ? 'Available' : ''))}</div>
            <div class="lot-status">
              ${lot.status === 'occupied' ? '<span class="badge badge-info">Occupied</span>' :
                lot.status === 'vacant' ? '<span class="badge badge-success">Vacant</span>' :
                '<span class="badge badge-gray">Reserved</span>'}
            </div>
            ${_isAdmin && lot.payment_flag ? `<div class="lot-balance">Bal: ${formatMoney(lot.balance_due)}</div>` : ''}
            ${lot.size_restriction ? `<div style="font-size:0.65rem;color:var(--warning);margin-top:2px">${lot.size_restriction}</div>` : ''}
            ${lot.flat_rate ? '<div style="font-size:0.65rem;color:#16a34a;margin-top:2px;font-weight:600">FLAT RATE</div>' : ''}
            ${lot.short_term_only ? '<div style="font-size:0.6rem;color:#0284c7;margin-top:1px;font-weight:600">⏱️ SHORT TERM</div>' : ''}
            ${_isAdmin && lot.deposit_waived ? '<div style="font-size:0.6rem;color:#9ca3af;margin-top:1px">🚫 DEP WAIVED</div>' : _isAdmin && lot.deposit_amount > 0 ? '<div style="font-size:0.6rem;color:#16a34a;margin-top:1px">💰 DEP PAID</div>' : ''}
          </div>
        `;}).join('')}
      </div>
    `).join('')}
  `;
}

async function showLotDetail(lotId) {
  const data = await API.get(`/lots/${lotId}/detail`);
  if (!data) return;
  const { lot, tenant, currentInvoice, invoices, payments, meters, messages } = data;

  if (!tenant) {
    let content = `
      <p><strong>Lot:</strong> ${lot.id} (${lot.width}x${lot.length} ft)</p>
      <p><strong>Status:</strong> <span class="badge badge-${lot.status === 'vacant' ? 'success' : 'gray'}">${lot.status}</span></p>
      ${lot.size_restriction ? `<p><strong>Restriction:</strong> ${lot.size_restriction}</p>` : ''}
      ${lot.notes ? `<p><strong>Notes:</strong> ${lot.notes}</p>` : ''}
      <hr style="margin:1rem 0">
      <div class="form-group">
        <label>Change Status</label>
        <select id="lot-status-select">
          <option value="vacant" ${lot.status === 'vacant' ? 'selected' : ''}>Vacant</option>
          <option value="occupied" ${lot.status === 'occupied' ? 'selected' : ''}>Occupied</option>
          <option value="owner_reserved" ${lot.status === 'owner_reserved' ? 'selected' : ''}>Owner Reserved</option>
        </select>
      </div>
      <button class="btn btn-primary btn-full" onclick="saveLotStatus('${lot.id}')">Save Status</button>
    `;
    showModal(`Lot ${lotId}`, content);
    return;
  }

  const tabs = `
    <div class="tab-bar">
      <button class="tab-btn active" onclick="switchLotTab(event,'tab-tenant')">Tenant</button>
      <button class="tab-btn" onclick="switchLotTab(event,'tab-billing')">Billing</button>
      <button class="tab-btn" onclick="switchLotTab(event,'tab-history')">History</button>
      <button class="tab-btn" onclick="switchLotTab(event,'tab-notices')">Notices</button>
    </div>
    <div id="tab-tenant" class="tab-pane active">
      <p><strong>Name:</strong> ${escapeHtml(tenant.first_name)} ${escapeHtml(tenant.last_name)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(tenant.phone || '—')}</p>
      <p><strong>Email:</strong> ${escapeHtml(tenant.email || '—')}</p>
      <p><strong>Move-in date:</strong> ${formatDate(tenant.move_in_date)}</p>
      <hr>
      <h4>RV Details</h4>
      <p><strong>Make/Model:</strong> ${(tenant.rv_make || '—')} ${(tenant.rv_model || '')}</p>
      <p><strong>Year:</strong> ${tenant.rv_year || '—'}</p>
      <p><strong>Length:</strong> ${tenant.rv_length || '—'}</p>
      <p><strong>License plate:</strong> ${tenant.license_plate || '—'}</p>
      <hr>
      <h4>Emergency Contact</h4>
      <p><strong>Name:</strong> ${tenant.emergency_contact || '—'}</p>
      <p><strong>Phone:</strong> ${tenant.emergency_phone || '—'}</p>
    </div>
    <div id="tab-billing" class="tab-pane" style="display:none">
      ${currentInvoice ? `
        <p><strong>Invoice:</strong> ${currentInvoice.invoice_number}</p>
        <p><strong>Date:</strong> ${formatDate(currentInvoice.invoice_date)} &nbsp; <strong>Due:</strong> ${formatDate(currentInvoice.due_date)}</p>
        <p><strong>Rent:</strong> ${formatMoney(currentInvoice.rent_amount)}</p>
        <p><strong>Electric:</strong> ${formatMoney(currentInvoice.electric_amount)}</p>
        <p><strong>Mailbox fee:</strong> ${formatMoney(currentInvoice.mailbox_fee)}</p>
        <p><strong>Misc fee:</strong> ${formatMoney(currentInvoice.misc_fee)} ${currentInvoice.misc_description ? '('+currentInvoice.misc_description+')' : ''}</p>
        <p><strong>Late fee:</strong> ${formatMoney(currentInvoice.late_fee)}</p>
        <p><strong>Credit/Refund:</strong> -${formatMoney(currentInvoice.refund_amount)}</p>
        <p><strong>Total:</strong> ${formatMoney(currentInvoice.total_amount)}</p>
        <p><strong>Paid:</strong> ${formatMoney(currentInvoice.amount_paid)}</p>
        <p><strong>Balance Due:</strong> <span style="color:${currentInvoice.balance_due > 0 ? '#dc2626' : '#16a34a'};font-weight:700">${formatMoney(currentInvoice.balance_due)}</span></p>
        <p><strong>Status:</strong> <span class="badge badge-${currentInvoice.status === 'paid' ? 'success' : 'warning'}">${currentInvoice.status}</span></p>
      ` : '<p>No invoices on file.</p>'}
    </div>
    <div id="tab-history" class="tab-pane" style="display:none">
      <h4>Recent Payments</h4>
      ${payments.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Ref</th></tr></thead><tbody>
        ${payments.slice(0,6).map(p => `<tr><td>${formatDate(p.payment_date)}</td><td>${formatMoney(p.amount)}</td><td>${p.payment_method || '—'}</td><td>${p.reference_number || '—'}</td></tr>`).join('')}
      </tbody></table>` : '<p>No payments recorded.</p>'}
      <h4 style="margin-top:1rem">Recent Meter Readings</h4>
      ${meters.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Prev</th><th>Curr</th><th>kWh</th><th>Charge</th></tr></thead><tbody>
        ${meters.map(m => `<tr><td>${formatDate(m.reading_date)}</td><td>${m.previous_reading}</td><td>${m.current_reading}</td><td>${m.kwh_used}</td><td>${formatMoney(m.electric_charge)}</td></tr>`).join('')}
      </tbody></table>` : '<p>No meter readings.</p>'}
    </div>
    <div id="tab-notices" class="tab-pane" style="display:none">
      ${messages.length ? messages.map(m => `
        <div class="notice-item">
          <div style="display:flex;justify-content:space-between"><strong>${m.subject || '(no subject)'}</strong><span style="font-size:0.75rem;color:var(--gray-500)">${formatDate((m.sent_date||'').split(' ')[0])}</span></div>
          <div style="font-size:0.8rem;color:var(--gray-700);margin-top:0.25rem">${escapeHtml(m.body || '')}</div>
        </div>
      `).join('') : '<p>No notices sent.</p>'}
    </div>
  `;

  showModal(`Lot ${lot.id} — ${tenant.first_name} ${tenant.last_name}`, tabs);
}

async function saveLotStatus(lotId) {
  const status = document.getElementById('lot-status-select')?.value;
  if (!status) return;
  try {
    await API.put(`/lots/${lotId}`, { status });
    closeModal();
    loadSiteMap();
  } catch (err) {
    alert('Failed to update status: ' + (err.message || 'unknown'));
  }
}

function switchLotTab(e, paneId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
  e.currentTarget.classList.add('active');
  const pane = document.getElementById(paneId);
  pane.style.display = '';
  pane.classList.add('active');
}
