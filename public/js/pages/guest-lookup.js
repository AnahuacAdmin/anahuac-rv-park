/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Guest Lookup & History
 */

async function loadGuestLookup() {
  document.getElementById('page-content').innerHTML = `
    ${helpPanel('guest-lookup')}
    <div class="page-header">
      <h2>🔍 Guest Lookup</h2>
    </div>
    <div class="card" style="margin-bottom:1.5rem">
      <div style="display:flex;gap:0.75rem;align-items:center">
        <input type="text" id="guest-search-input" placeholder="Search by name, phone, or email..." style="flex:1;padding:0.65rem 1rem;border:1px solid #d1d5db;border-radius:8px;font-size:0.95rem">
        <button class="btn btn-primary" id="guest-search-btn">Search</button>
      </div>
    </div>
    <div id="guest-search-results"></div>
    <div id="guest-profile-area"></div>
  `;

  const input = document.getElementById('guest-search-input');
  const btn = document.getElementById('guest-search-btn');
  btn.addEventListener('click', () => doGuestSearch());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doGuestSearch(); });
  input.focus();
}

async function doGuestSearch() {
  const q = document.getElementById('guest-search-input').value.trim();
  if (!q) return;
  const results = document.getElementById('guest-search-results');
  const profile = document.getElementById('guest-profile-area');
  profile.innerHTML = '';
  results.innerHTML = '<p style="color:#78716c">Searching...</p>';

  try {
    const data = await API.get('/tenants/lookup?q=' + encodeURIComponent(q));
    if (!data || data.length === 0) {
      results.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">No guests found matching "' + q.replace(/</g,'&lt;') + '"</div>';
      return;
    }
    results.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0.75rem">' +
      data.map(t => {
        const statusColor = t.is_active ? '#16a34a' : '#78716c';
        const statusLabel = t.is_active ? 'Active' : 'Checked Out';
        const ratingColor = t.guest_rating === 'red' ? '#ef4444' : t.guest_rating === 'yellow' ? '#eab308' : '#22c55e';
        return `<div class="card" style="cursor:pointer;padding:1rem;transition:box-shadow 0.2s" onclick="openGuestProfile(${t.id})" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'" onmouseout="this.style.boxShadow=''">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${ratingColor};flex-shrink:0" title="Rating: ${t.guest_rating || 'green'}"></span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:0.95rem">${t.first_name} ${t.last_name}</div>
              <div style="font-size:0.8rem;color:#78716c">${t.lot_id ? 'Lot ' + t.lot_id : 'No lot'} &middot; ${t.phone || 'No phone'}</div>
            </div>
            <span style="font-size:0.7rem;font-weight:600;padding:0.2rem 0.5rem;border-radius:12px;background:${statusColor}20;color:${statusColor}">${statusLabel}</span>
          </div>
        </div>`;
      }).join('') + '</div>';
  } catch (err) {
    results.innerHTML = '<div class="card" style="color:#ef4444;padding:1rem">Search failed: ' + err.message + '</div>';
  }
}

async function openGuestProfile(tenantId) {
  const area = document.getElementById('guest-profile-area');
  area.innerHTML = '<p style="color:#78716c">Loading guest profile...</p>';

  try {
    const d = await API.get('/tenants/' + tenantId + '/full-history');
    const t = d.tenant;
    const ratingColor = t.guest_rating === 'red' ? '#ef4444' : t.guest_rating === 'yellow' ? '#eab308' : '#22c55e';

    area.innerHTML = `
      <div class="card" style="margin-top:1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${ratingColor}" title="${t.guest_rating || 'green'}"></span>
            <h3 style="margin:0">${t.first_name} ${t.last_name}</h3>
            <span style="font-size:0.75rem;padding:0.15rem 0.5rem;border-radius:12px;background:${t.is_active ? '#dcfce7' : '#f3f4f6'};color:${t.is_active ? '#16a34a' : '#78716c'}">${t.is_active ? 'Active' : 'Checked Out'}</span>
          </div>
          <button class="btn btn-sm" onclick="document.getElementById('guest-profile-area').innerHTML=''">&times; Close</button>
        </div>

        <div class="guest-profile-tabs" style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:1rem">
          <button class="guest-tab active" data-tab="overview" onclick="switchGuestTab(this,'overview',${tenantId})">Overview</button>
          <button class="guest-tab" data-tab="stays" onclick="switchGuestTab(this,'stays',${tenantId})">Stay History</button>
          <button class="guest-tab" data-tab="payments" onclick="switchGuestTab(this,'payments',${tenantId})">Payments</button>
          <button class="guest-tab" data-tab="notes" onclick="switchGuestTab(this,'notes',${tenantId})">Notes & Flags</button>
          <button class="guest-tab" data-tab="incidents" onclick="switchGuestTab(this,'incidents',${tenantId})">Incidents</button>
        </div>

        <div id="guest-tab-content"></div>
      </div>
    `;

    // Store data globally for tab rendering
    window._guestProfileData = d;
    renderGuestTab('overview', tenantId);
  } catch (err) {
    area.innerHTML = '<div class="card" style="color:#ef4444;padding:1rem">Failed to load profile: ' + err.message + '</div>';
  }
}

function switchGuestTab(btn, tab, tenantId) {
  document.querySelectorAll('.guest-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderGuestTab(tab, tenantId);
}

function renderGuestTab(tab, tenantId) {
  const el = document.getElementById('guest-tab-content');
  const d = window._guestProfileData;
  if (!d) return;
  const t = d.tenant;

  if (tab === 'overview') {
    const totalPaid = (d.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div>
          <h4 style="margin:0 0 0.5rem;color:#78716c;font-size:0.8rem;text-transform:uppercase">Contact Info</h4>
          <p style="margin:0.25rem 0"><strong>Phone:</strong> ${t.phone || '—'}</p>
          <p style="margin:0.25rem 0"><strong>Email:</strong> ${t.email || '—'}</p>
          <p style="margin:0.25rem 0"><strong>Emergency:</strong> ${t.emergency_contact || '—'} ${t.emergency_phone ? '(' + t.emergency_phone + ')' : ''}</p>
          <p style="margin:0.25rem 0"><strong>ID #:</strong> ${t.id_number || '—'}</p>
          <p style="margin:0.25rem 0"><strong>DOB:</strong> ${t.date_of_birth ? formatDate(t.date_of_birth) : '—'}</p>
        </div>
        <div>
          <h4 style="margin:0 0 0.5rem;color:#78716c;font-size:0.8rem;text-transform:uppercase">Lot & Billing</h4>
          <p style="margin:0.25rem 0"><strong>Current/Last Lot:</strong> ${t.lot_id || '—'}</p>
          <p style="margin:0.25rem 0"><strong>Monthly Rent:</strong> ${formatMoney(t.monthly_rent)}</p>
          <p style="margin:0.25rem 0"><strong>Move-In:</strong> ${t.move_in_date ? formatDate(t.move_in_date) : '—'}</p>
          <p style="margin:0.25rem 0"><strong>Move-Out:</strong> ${t.move_out_date ? formatDate(t.move_out_date) : '—'}</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-top:1rem">
        <div class="stat-card"><div class="stat-value">${t.guest_rating === 'red' ? '🔴' : t.guest_rating === 'yellow' ? '🟡' : '🟢'}</div><div class="stat-label">Rating</div></div>
        <div class="stat-card"><div class="stat-value">${(d.checkins || []).length}</div><div class="stat-label">Total Stays</div></div>
        <div class="stat-card"><div class="stat-value">${formatMoney(totalPaid)}</div><div class="stat-label">Lifetime Paid</div></div>
      </div>
      <div style="margin-top:1rem">
        <h4 style="margin:0 0 0.5rem;color:#78716c;font-size:0.8rem;text-transform:uppercase">Vehicle</h4>
        <p style="margin:0.25rem 0">${[t.rv_year, t.rv_make, t.rv_model].filter(Boolean).join(' ') || '—'} ${t.rv_length ? '(' + t.rv_length + '\')' : ''} ${t.license_plate ? '• Plate: ' + t.license_plate : ''}</p>
      </div>
    `;
  }

  else if (tab === 'stays') {
    const checkins = d.checkins || [];
    if (!checkins.length) {
      el.innerHTML = '<p style="color:#78716c;text-align:center;padding:2rem">No stay history found.</p>';
      return;
    }
    el.innerHTML = `<table class="data-table" style="width:100%">
      <thead><tr><th>Lot</th><th>Check-In</th><th>Check-Out</th><th>Duration</th><th>Status</th><th>Statement</th></tr></thead>
      <tbody>${checkins.map(c => {
        let dur = '—';
        if (c.check_in_date && c.check_out_date) {
          const days = Math.round((new Date(c.check_out_date) - new Date(c.check_in_date)) / 86400000);
          dur = days + ' day' + (days !== 1 ? 's' : '');
        } else if (c.check_in_date) {
          const days = Math.round((Date.now() - new Date(c.check_in_date)) / 86400000);
          dur = days + ' day' + (days !== 1 ? 's' : '') + ' (ongoing)';
        }
        const hasStatement = c.move_out_statement ? true : false;
        return `<tr>
          <td>${c.lot_id || '—'}</td>
          <td>${formatDate(c.check_in_date)}</td>
          <td>${formatDate(c.check_out_date)}</td>
          <td>${dur}</td>
          <td><span style="font-size:0.75rem;padding:0.15rem 0.5rem;border-radius:12px;background:${c.status === 'checked_in' ? '#dcfce7' : '#f3f4f6'};color:${c.status === 'checked_in' ? '#16a34a' : '#78716c'}">${c.status === 'checked_in' ? 'Checked In' : 'Checked Out'}</span></td>
          <td>${hasStatement ? '<a href="#" onclick="event.preventDefault();viewMoveOutStatement(' + c.id + ')" style="color:#2563eb;font-size:0.8rem">View</a>' : '—'}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  else if (tab === 'payments') {
    const payments = d.payments || [];
    const invoices = d.invoices || [];
    el.innerHTML = `
      <h4 style="margin:0 0 0.5rem;color:#78716c;font-size:0.8rem;text-transform:uppercase">Invoices (${invoices.length})</h4>
      ${invoices.length ? `<table class="data-table" style="width:100%;margin-bottom:1.5rem">
        <thead><tr><th>#</th><th>Date</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
        <tbody>${invoices.map(i => {
          const sc = i.status === 'paid' ? '#16a34a' : i.status === 'partial' ? '#eab308' : '#ef4444';
          return `<tr>
            <td>${i.invoice_number || i.id}</td>
            <td>${formatDate(i.invoice_date)}</td>
            <td>${formatMoney(i.total_amount)}</td>
            <td>${formatMoney(i.amount_paid)}</td>
            <td>${formatMoney(i.balance_due)}</td>
            <td><span style="font-size:0.7rem;padding:0.15rem 0.4rem;border-radius:12px;background:${sc}20;color:${sc}">${i.status}</span></td>
          </tr>`;
        }).join('')}</tbody></table>` : '<p style="color:#78716c;margin-bottom:1.5rem">No invoices.</p>'}

      <h4 style="margin:0 0 0.5rem;color:#78716c;font-size:0.8rem;text-transform:uppercase">Payments (${payments.length})</h4>
      ${payments.length ? `<table class="data-table" style="width:100%">
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Notes</th></tr></thead>
        <tbody>${payments.map(p => `<tr>
          <td>${formatDate(p.payment_date)}</td>
          <td>${formatMoney(p.amount)}</td>
          <td>${p.payment_method || '—'}</td>
          <td>${p.reference_number || '—'}</td>
          <td style="font-size:0.8rem;color:#78716c">${p.notes || '—'}</td>
        </tr>`).join('')}</tbody></table>` : '<p style="color:#78716c">No payments.</p>'}
    `;
  }

  else if (tab === 'notes') {
    const notes = d.notes || [];
    const rating = t.guest_rating || 'green';
    el.innerHTML = `
      <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:1.5rem">
        <div>
          <h4 style="margin:0 0 0.5rem;color:#78716c;font-size:0.8rem;text-transform:uppercase">Guest Rating</h4>
          <div style="display:flex;gap:0.75rem;align-items:center" id="rating-selector">
            <label style="cursor:pointer;display:flex;align-items:center;gap:0.3rem">
              <input type="radio" name="guest-rating" value="green" ${rating === 'green' ? 'checked' : ''} onchange="updateGuestRating(${tenantId},this.value)">
              <span style="color:#22c55e;font-weight:600">🟢 Good</span>
            </label>
            <label style="cursor:pointer;display:flex;align-items:center;gap:0.3rem">
              <input type="radio" name="guest-rating" value="yellow" ${rating === 'yellow' ? 'checked' : ''} onchange="updateGuestRating(${tenantId},this.value)">
              <span style="color:#eab308;font-weight:600">🟡 Caution</span>
            </label>
            <label style="cursor:pointer;display:flex;align-items:center;gap:0.3rem">
              <input type="radio" name="guest-rating" value="red" ${rating === 'red' ? 'checked' : ''} onchange="updateGuestRating(${tenantId},this.value)">
              <span style="color:#ef4444;font-weight:600">🔴 Do Not Re-Rent</span>
            </label>
          </div>
          <div id="red-reason-box" style="display:none;margin-top:0.5rem">
            <input type="text" id="red-reason-input" placeholder="Reason for flagging (required)" style="width:100%;padding:0.5rem;border:1px solid #fca5a5;border-radius:6px">
            <button class="btn btn-sm" style="margin-top:0.35rem;background:#ef4444;color:#fff" id="red-reason-submit">Confirm Flag</button>
          </div>
        </div>
      </div>

      <div style="margin-bottom:1rem;padding:1rem;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
        <h4 style="margin:0 0 0.5rem;font-size:0.85rem">Add Note</h4>
        <div style="display:flex;gap:0.5rem">
          <input type="text" id="add-note-text" placeholder="Type a note..." style="flex:1;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px">
          <button class="btn btn-primary btn-sm" onclick="addGuestNote(${tenantId})">Add Note</button>
        </div>
      </div>

      <div id="guest-notes-list">
        ${notes.length ? notes.map(n => `<div style="padding:0.6rem 0;border-bottom:1px solid #f3f4f6;display:flex;gap:0.75rem">
          <div style="font-size:0.7rem;color:#a8a29e;white-space:nowrap;min-width:130px">${n.created_at ? new Date(n.created_at).toLocaleString() : '—'}</div>
          <div style="font-size:0.85rem;flex:1">${n.note_type === 'flag' ? '<span style="color:#ef4444;font-weight:700">⚠️ FLAG:</span> ' : ''}${n.note_text}</div>
        </div>`).join('') : '<p style="color:#78716c;text-align:center;padding:1rem">No notes yet.</p>'}
      </div>
    `;
  }

  else if (tab === 'incidents') {
    const incidents = d.incidents || [];
    el.innerHTML = `
      <div style="margin-bottom:1rem;padding:1rem;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
        <h4 style="margin:0 0 0.5rem;font-size:0.85rem">Log Incident</h4>
        <div style="display:grid;grid-template-columns:auto auto 1fr;gap:0.5rem;align-items:end">
          <div>
            <label style="font-size:0.7rem;color:#78716c">Date</label>
            <input type="date" id="incident-date" value="${new Date().toISOString().split('T')[0]}" style="padding:0.4rem;border:1px solid #d1d5db;border-radius:6px;width:100%">
          </div>
          <div>
            <label style="font-size:0.7rem;color:#78716c">Category</label>
            <select id="incident-category" style="padding:0.4rem;border:1px solid #d1d5db;border-radius:6px;width:100%">
              <option value="noise">Noise</option>
              <option value="late_payment">Late Payment</option>
              <option value="rule_violation">Rule Violation</option>
              <option value="property_damage">Property Damage</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.7rem;color:#78716c">Description</label>
            <input type="text" id="incident-desc" placeholder="What happened..." style="padding:0.4rem;border:1px solid #d1d5db;border-radius:6px;width:100%">
          </div>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:0.5rem" onclick="addGuestIncident(${tenantId})">Log Incident</button>
      </div>

      <div id="guest-incidents-list">
        ${incidents.length ? `<table class="data-table" style="width:100%">
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Logged</th></tr></thead>
          <tbody>${incidents.map(inc => `<tr>
            <td>${formatDate(inc.incident_date)}</td>
            <td><span style="font-size:0.75rem;padding:0.15rem 0.4rem;border-radius:12px;background:#fef3c7;color:#92400e">${inc.category.replace(/_/g,' ')}</span></td>
            <td style="font-size:0.85rem">${inc.description}</td>
            <td style="font-size:0.75rem;color:#a8a29e">${inc.created_at ? new Date(inc.created_at).toLocaleString() : '—'}</td>
          </tr>`).join('')}</tbody></table>` : '<p style="color:#78716c;text-align:center;padding:1rem">No incidents logged.</p>'}
      </div>
    `;
  }
}

async function updateGuestRating(tenantId, rating) {
  if (rating === 'red') {
    const box = document.getElementById('red-reason-box');
    if (box) box.style.display = '';
    const submitBtn = document.getElementById('red-reason-submit');
    if (submitBtn) {
      submitBtn.onclick = async function() {
        const reason = document.getElementById('red-reason-input').value.trim();
        if (!reason) { showStatusToast('❌', 'Reason is required for red flag.'); return; }
        try {
          await API.put('/tenants/' + tenantId + '/rating', { rating: 'red', reason: reason });
          showStatusToast('🔴', 'Guest flagged — DO NOT RE-RENT');
          openGuestProfile(tenantId);
        } catch (err) { showStatusToast('❌', err.message); }
      };
    }
    return;
  }

  const box = document.getElementById('red-reason-box');
  if (box) box.style.display = 'none';

  try {
    await API.put('/tenants/' + tenantId + '/rating', { rating: rating });
    showStatusToast('✅', 'Rating updated to ' + rating);
    window._guestProfileData.tenant.guest_rating = rating;
  } catch (err) { showStatusToast('❌', err.message); }
}

async function addGuestNote(tenantId) {
  const input = document.getElementById('add-note-text');
  const text = input.value.trim();
  if (!text) return;

  try {
    await API.post('/tenants/' + tenantId + '/notes', { note_text: text, note_type: 'general' });
    input.value = '';
    showStatusToast('✅', 'Note added');
    openGuestProfile(tenantId);
    setTimeout(() => switchGuestTab(document.querySelector('.guest-tab[data-tab="notes"]'), 'notes', tenantId), 100);
  } catch (err) { showStatusToast('❌', err.message); }
}

async function addGuestIncident(tenantId) {
  const dateEl = document.getElementById('incident-date');
  const catEl = document.getElementById('incident-category');
  const descEl = document.getElementById('incident-desc');
  const desc = descEl.value.trim();
  if (!desc) { showStatusToast('❌', 'Description is required.'); return; }

  try {
    await API.post('/tenants/' + tenantId + '/incidents', {
      incident_date: dateEl.value,
      category: catEl.value,
      description: desc
    });
    descEl.value = '';
    showStatusToast('✅', 'Incident logged');
    openGuestProfile(tenantId);
    setTimeout(() => switchGuestTab(document.querySelector('.guest-tab[data-tab="incidents"]'), 'incidents', tenantId), 100);
  } catch (err) { showStatusToast('❌', err.message); }
}

function viewMoveOutStatement(checkinId) {
  const d = window._guestProfileData;
  if (!d) return;
  const checkin = (d.checkins || []).find(c => c.id === checkinId);
  if (!checkin || !checkin.move_out_statement) { showStatusToast('❌', 'No statement found.'); return; }
  const stmt = typeof checkin.move_out_statement === 'string' ? JSON.parse(checkin.move_out_statement) : checkin.move_out_statement;
  showModal('Move-Out Statement', `<pre style="white-space:pre-wrap;font-size:0.82rem;max-height:60vh;overflow:auto">${JSON.stringify(stmt, null, 2)}</pre>`);
}
