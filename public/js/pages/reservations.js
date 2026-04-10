let _resView = 'list'; // 'list' or 'calendar'
let _allReservations = [];

async function loadReservations() {
  _allReservations = await API.get('/reservations') || [];
  if (_resView === 'calendar') { renderCalendar(); return; }
  renderReservationList();
}

function renderReservationList() {
  const upcoming = _allReservations.filter(r => r.status !== 'cancelled' && r.status !== 'checked-out' && r.departure_date >= new Date().toISOString().split('T')[0]);
  const past = _allReservations.filter(r => !upcoming.includes(r));

  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <h2>Reservations</h2>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="showNewReservation()">+ New Reservation</button>
        <button class="btn btn-outline" onclick="_resView='calendar';renderCalendar()">Calendar View</button>
      </div>
    </div>
    <div class="filter-bar">
      <select id="res-status-filter" onchange="filterReservations(this.value)">
        <option value="all">All Statuses</option>
        <option value="pending">Pending</option>
        <option value="confirmed">Confirmed</option>
        <option value="checked-in">Checked In</option>
        <option value="checked-out">Checked Out</option>
        <option value="cancelled">Cancelled</option>
      </select>
    </div>
    <div class="card">
      <h3 style="margin-bottom:0.75rem">Upcoming & Active (${upcoming.length})</h3>
      <div class="table-container">
        <table>
          <thead><tr><th>Conf #</th><th>Guest</th><th>Lot</th><th>Arrive</th><th>Depart</th><th>Nights</th><th>Rate</th><th>Total</th><th>Deposit</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="res-upcoming">${resRows(upcoming)}</tbody>
        </table>
      </div>
    </div>
    ${past.length ? `
    <div class="card mt-2">
      <h3 style="margin-bottom:0.75rem">Past & Cancelled (${past.length})</h3>
      <div class="table-container">
        <table>
          <thead><tr><th>Conf #</th><th>Guest</th><th>Lot</th><th>Arrive</th><th>Depart</th><th>Nights</th><th>Rate</th><th>Total</th><th>Deposit</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${resRows(past)}</tbody>
        </table>
      </div>
    </div>` : ''}
  `;
}

function resRows(list) {
  if (!list.length) return '<tr><td colspan="11" class="text-center">No reservations</td></tr>';
  return list.map(r => {
    const badge = { pending:'warning', confirmed:'info', 'checked-in':'success', 'checked-out':'gray', cancelled:'danger' }[r.status] || 'gray';
    return `
      <tr class="res-row" data-status="${r.status}">
        <td><strong>${r.confirmation_number}</strong></td>
        <td>${r.guest_name}</td>
        <td><strong>${r.lot_id || '—'}</strong></td>
        <td>${formatDate(r.arrival_date)}</td>
        <td>${formatDate(r.departure_date)}</td>
        <td>${r.nights}</td>
        <td>${formatMoney(r.rate_per_night)}</td>
        <td><strong>${formatMoney(r.total_amount)}</strong></td>
        <td>${formatMoney(r.deposit_paid)}</td>
        <td><span class="badge badge-${badge}">${r.status}</span></td>
        <td class="btn-group">
          <button class="btn btn-sm btn-outline" onclick="viewReservation(${r.id})">View</button>
          <button class="btn btn-sm btn-outline" onclick="editReservation(${r.id})">Edit</button>
          ${r.status === 'confirmed' || r.status === 'pending' ? `<button class="btn btn-sm btn-success" onclick="checkinReservation(${r.id})">Check In</button>` : ''}
          ${r.status !== 'cancelled' && r.status !== 'checked-out' && r.status !== 'checked-in' ? `<button class="btn btn-sm btn-danger" onclick="cancelReservation(${r.id})">Cancel</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function filterReservations(status) {
  const filtered = status === 'all' ? _allReservations : _allReservations.filter(r => r.status === status);
  document.getElementById('res-upcoming')?.closest('tbody')?.parentElement?.closest('.card')?.querySelector('tbody')
  // Simpler: re-render full list.
  if (status === 'all') { renderReservationList(); return; }
  document.getElementById('page-content').querySelector('#res-upcoming').innerHTML = resRows(filtered);
}

async function showNewReservation() {
  const lots = await API.get('/lots');
  showModal('New Reservation', resForm(lots));
}

function resForm(lots, r = {}) {
  const today = new Date().toISOString().split('T')[0];
  return `
    <form onsubmit="saveReservation(event, ${r.id || 'null'})">
      <div class="form-group"><label>Guest Name</label><input name="guest_name" value="${r.guest_name || ''}" required></div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input name="phone" value="${r.phone || ''}"></div>
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${r.email || ''}"></div>
      </div>
      <div class="form-group">
        <label>Lot</label>
        <select name="lot_id" required>
          <option value="">Select lot...</option>
          ${lots.map(l => `<option value="${l.id}" ${r.lot_id === l.id ? 'selected' : ''}>${l.id} — ${l.status}${l.size_restriction ? ' (' + l.size_restriction + ')' : ''}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Arrival Date</label><input name="arrival_date" type="date" value="${r.arrival_date || today}" required onchange="calcResNights(this.form)"></div>
        <div class="form-group"><label>Departure Date</label><input name="departure_date" type="date" value="${r.departure_date || ''}" required onchange="calcResNights(this.form)"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Rate per Night ($)</label><input name="rate_per_night" type="number" step="0.01" value="${r.rate_per_night ?? 50}" onchange="calcResNights(this.form)"></div>
        <div class="form-group"><label>Deposit Paid ($)</label><input name="deposit_paid" type="number" step="0.01" value="${r.deposit_paid || 0}"></div>
      </div>
      <div id="res-calc" style="background:#eff6ff;padding:0.6rem 1rem;border-radius:6px;margin-bottom:1rem;font-size:0.9rem;display:none">
        <strong id="res-nights-display"></strong> nights &times; $<span id="res-rate-display"></span> = <strong id="res-total-display"></strong>
      </div>
      ${r.id ? `
      <div class="form-group">
        <label>Status</label>
        <select name="status">
          ${['pending','confirmed','checked-in','checked-out','cancelled'].map(s => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="form-group"><label>Notes</label><textarea name="notes">${r.notes || ''}</textarea></div>
      <button type="submit" class="btn btn-primary btn-full mt-2">${r.id ? 'Update' : 'Create'} Reservation</button>
      <p id="res-form-error" class="error-text" style="display:none"></p>
    </form>
  `;
}

function calcResNights(form) {
  const a = new Date(form.arrival_date.value);
  const d = new Date(form.departure_date.value);
  const calcEl = document.getElementById('res-calc');
  if (!a || !d || isNaN(a) || isNaN(d) || d <= a) { if (calcEl) calcEl.style.display = 'none'; return; }
  const nights = Math.round((d - a) / 86400000);
  const rate = parseFloat(form.rate_per_night.value) || 0;
  const total = (nights * rate).toFixed(2);
  document.getElementById('res-nights-display').textContent = nights;
  document.getElementById('res-rate-display').textContent = rate.toFixed(2);
  document.getElementById('res-total-display').textContent = '$' + total;
  if (calcEl) calcEl.style.display = '';
}

async function saveReservation(e, id) {
  e.preventDefault();
  const errEl = document.getElementById('res-form-error');
  if (errEl) errEl.style.display = 'none';
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);
  data.rate_per_night = parseFloat(data.rate_per_night) || 50;
  data.deposit_paid = parseFloat(data.deposit_paid) || 0;
  try {
    if (id) {
      await API.put(`/reservations/${id}`, data);
    } else {
      const r = await API.post('/reservations', data);
      if (r?.confirmation_number) {
        alert(`Reservation created.\nConfirmation: ${r.confirmation_number}\n${r.nights} nights — ${formatMoney(r.total_amount)}`);
      }
    }
    closeModal();
    loadReservations();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.style.display = ''; }
    else alert('Error: ' + err.message);
  }
}

async function editReservation(id) {
  const [r, lots] = await Promise.all([API.get(`/reservations/${id}`), API.get('/lots')]);
  if (!r) return;
  showModal(`Edit Reservation ${r.confirmation_number}`, resForm(lots, r));
  setTimeout(() => calcResNights(document.querySelector('#modal-body form')), 50);
}

async function viewReservation(id) {
  const r = await API.get(`/reservations/${id}`);
  if (!r) return;
  const balance = Math.max(0, (r.total_amount || 0) - (r.deposit_paid || 0));
  showModal(`Reservation ${r.confirmation_number}`, `
    <div class="invoice-print" id="res-confirmation">
      <div class="invoice-header">
        <div style="display:flex;align-items:center;gap:1rem">
          <img src="/park_Logo.png" alt="Anahuac RV Park" style="height:90px;width:auto">
          <div>
            <h2>Anahuac RV Park, LLC</h2>
            <p>1003 Davis Ave, Anahuac, TX 77514</p>
            <p>409-267-6603</p>
          </div>
        </div>
        <div style="text-align:right">
          <h3>RESERVATION</h3>
          <p><strong>${r.confirmation_number}</strong></p>
          <p>Created: ${formatDate((r.created_at || '').split(' ')[0])}</p>
        </div>
      </div>
      <div style="margin-bottom:1.5rem">
        <p><strong>Guest:</strong> ${r.guest_name}</p>
        ${r.phone ? `<p><strong>Phone:</strong> ${r.phone}</p>` : ''}
        ${r.email ? `<p><strong>Email:</strong> ${r.email}</p>` : ''}
        <p><strong>Lot:</strong> ${r.lot_id}</p>
      </div>
      <div class="line-items">
        <table>
          <tbody>
            <tr><td>Arrival</td><td class="text-right">${formatDate(r.arrival_date)}</td></tr>
            <tr><td>Departure</td><td class="text-right">${formatDate(r.departure_date)}</td></tr>
            <tr><td>Nights</td><td class="text-right">${r.nights}</td></tr>
            <tr><td>Rate per Night</td><td class="text-right">${formatMoney(r.rate_per_night)}</td></tr>
            <tr class="total-row"><td><strong>Total</strong></td><td class="text-right"><strong>${formatMoney(r.total_amount)}</strong></td></tr>
            <tr><td>Deposit Paid</td><td class="text-right">${formatMoney(r.deposit_paid)}</td></tr>
            <tr class="total-row"><td><strong>Balance Due on Arrival</strong></td><td class="text-right"><strong>${formatMoney(balance)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      ${r.notes ? `<p style="margin-top:1rem"><strong>Notes:</strong> ${r.notes}</p>` : ''}
      <p style="margin-top:1.5rem;font-size:0.85rem;color:#555">
        Status: <strong>${r.status}</strong><br>
        Please present this confirmation upon arrival. Check-in time is 2:00 PM and check-out time is 11:00 AM.
        For questions or changes call 409-267-6603.
      </p>
    </div>
    <div class="no-print mt-2 btn-group">
      <button class="btn btn-primary" onclick="window.print()">Print Confirmation</button>
      <button class="btn btn-outline" onclick="downloadResConfirmationPdf('${r.confirmation_number}')">Download PDF</button>
      ${r.email ? `<button class="btn btn-outline" onclick="emailResConfirmation(${r.id})">Email to Guest</button>` : ''}
    </div>
  `);
}

async function downloadResConfirmationPdf(confNum) {
  const el = document.getElementById('res-confirmation');
  if (!el || typeof html2pdf === 'undefined') return;
  await html2pdf().set({
    margin: [0.4, 0.4, 0.5, 0.4],
    filename: `Reservation-${confNum}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#fff' },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
  }).from(el).save();
}

async function emailResConfirmation(id) {
  alert('Email confirmation coming soon — use Download PDF + manual email for now.');
}

async function cancelReservation(id) {
  if (!confirm('Cancel this reservation?')) return;
  try {
    await API.post(`/reservations/${id}/cancel`, {});
    loadReservations();
  } catch (err) { alert('Cancel failed: ' + err.message); }
}

async function checkinReservation(id) {
  if (!confirm('Convert this reservation to a full check-in? This creates a tenant record and marks the lot as occupied.')) return;
  try {
    await API.post(`/reservations/${id}/checkin`, {});
    alert('Guest checked in and tenant record created.');
    loadReservations();
  } catch (err) { alert('Check-in failed: ' + err.message); }
}

// --- Calendar View ---
let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-indexed

function renderCalendar() {
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  const monthName = new Date(_calYear, _calMonth).toLocaleString('default', { month: 'long' });
  const from = `${_calYear}-${String(_calMonth + 1).padStart(2, '0')}-01`;
  const to = `${_calYear}-${String(_calMonth + 1).padStart(2, '0')}-${daysInMonth}`;

  // Filter reservations in this month range.
  const inRange = _allReservations.filter(r =>
    r.status !== 'cancelled' && r.arrival_date <= to && r.departure_date >= from
  );

  // Build lot→days grid.
  const lotIds = [...new Set(inRange.map(r => r.lot_id))].sort();
  const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <h2>Reservations Calendar</h2>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="showNewReservation()">+ New Reservation</button>
        <button class="btn btn-outline" onclick="_resView='list';renderReservationList()">List View</button>
      </div>
    </div>
    <div class="filter-bar" style="justify-content:center">
      <button class="btn btn-outline" onclick="calPrev()">&larr;</button>
      <strong style="min-width:150px;text-align:center">${monthName} ${_calYear}</strong>
      <button class="btn btn-outline" onclick="calNext()">&rarr;</button>
    </div>
    ${lotIds.length ? `
    <div class="card">
      <div class="table-container">
        <table class="cal-table">
          <thead>
            <tr>
              <th class="cal-lot-col">Lot</th>
              ${dayHeaders.map(d => `<th class="cal-day-col">${d}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${lotIds.map(lot => {
              const lotRes = inRange.filter(r => r.lot_id === lot);
              return `<tr>
                <td class="cal-lot-col"><strong>${lot}</strong></td>
                ${dayHeaders.map(d => {
                  const dateStr = `${_calYear}-${String(_calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const hit = lotRes.find(r => r.arrival_date <= dateStr && r.departure_date > dateStr);
                  if (!hit) return '<td class="cal-day-col"></td>';
                  const color = { pending: '#fbbf24', confirmed: '#60a5fa', 'checked-in': '#34d399' }[hit.status] || '#d1d5db';
                  const isStart = hit.arrival_date === dateStr;
                  return `<td class="cal-day-col" style="background:${color}" title="${hit.guest_name} (${hit.status})">${isStart ? hit.guest_name.split(' ')[0] : ''}</td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '<div class="card"><p class="empty-state">No reservations this month.</p></div>'}
  `;
}

function calPrev() {
  _calMonth--;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  renderCalendar();
}
function calNext() {
  _calMonth++;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  renderCalendar();
}
