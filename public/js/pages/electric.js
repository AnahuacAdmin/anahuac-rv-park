/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
let _electricMonths = 6;

async function loadElectric() {
  const data = await API.get(`/electric/analytics?months=${_electricMonths}`);
  if (!data) return;

  const trend = data.lastMonth.totalKwh > 0
    ? ((data.currentMonth.totalKwh - data.lastMonth.totalKwh) / data.lastMonth.totalKwh * 100).toFixed(0)
    : 0;
  const trendIcon = trend >= 0 ? '↑' : '↓';
  const trendColor = trend <= 0 ? '#16a34a' : '#dc2626'; // Lower usage = green

  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <h2>⚡ Electric Analytics</h2>
      <div class="btn-group">
        <button class="btn btn-sm ${_electricMonths===3?'btn-primary':'btn-outline'}" onclick="_electricMonths=3;loadElectric()">3 Mo</button>
        <button class="btn btn-sm ${_electricMonths===6?'btn-primary':'btn-outline'}" onclick="_electricMonths=6;loadElectric()">6 Mo</button>
        <button class="btn btn-sm ${_electricMonths===12?'btn-primary':'btn-outline'}" onclick="_electricMonths=12;loadElectric()">12 Mo</button>
      </div>
    </div>

    <div class="dash-top-bar">
      <div class="dash-top-item dash-border-blue">
        <div class="dash-top-icon">📊</div>
        <span class="dash-top-val">${data.avgKwh.toLocaleString()}</span>
        <span class="dash-top-label">Avg KWH/Lot</span>
      </div>
      <div class="dash-top-item dash-border-red">
        <div class="dash-top-icon">🔴</div>
        <span class="dash-top-val">${data.highest ? data.highest.kwh.toLocaleString() : '—'}</span>
        <span class="dash-top-label">Highest: ${data.highest ? data.highest.lot_id + ' ' + (data.highest.first_name || '') : '—'}</span>
      </div>
      <div class="dash-top-item dash-border-green">
        <div class="dash-top-icon">🟢</div>
        <span class="dash-top-val">${data.lowest ? data.lowest.kwh.toLocaleString() : '—'}</span>
        <span class="dash-top-label">Lowest: ${data.lowest ? data.lowest.lot_id + ' ' + (data.lowest.first_name || '') : '—'}</span>
      </div>
      <div class="dash-top-item dash-border-purple">
        <div class="dash-top-icon">💰</div>
        <span class="dash-top-val">$${data.avgCharge.toFixed(2)}</span>
        <span class="dash-top-label">Avg Bill/Lot</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <h3>Usage by Lot (Last ${_electricMonths} Months)</h3>
      <div style="height:350px"><canvas id="electricChart"></canvas></div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <h3>Per-Lot Detail</h3>
      <div class="form-row">
        <div class="form-group">
          <label>Select Lot</label>
          <select id="electric-lot-select" onchange="loadLotDetail(this.value)">
            <option value="">Choose a lot...</option>
            ${data.allLots.map(l => `<option value="${l}">${l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="lot-detail-content"></div>
    </div>
  `;

  window._electricData = data;
  setTimeout(() => renderElectricChart(data), 100);
}

function renderElectricChart(data) {
  const ctx = document.getElementById('electricChart')?.getContext('2d');
  if (!ctx || typeof Chart === 'undefined') return;

  const colors = ['#1a5c32','#dc2626','#f59e0b','#0284c7','#7c3aed','#06b6d4','#f97316','#ec4899','#84cc16','#6366f1',
    '#14b8a6','#e11d48','#a855f7','#0ea5e9','#facc15','#fb923c','#4ade80','#c084fc','#38bdf8','#fbbf24'];
  const labels = data.history.map(h => h.label);
  const datasets = data.allLots.slice(0, 20).map((lot, i) => ({
    label: lot,
    data: data.history.map(h => { const r = h.readings.find(x => x.lot_id === lot); return r ? r.kwh : 0; }),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length] + '20',
    borderWidth: 2,
    tension: 0.3,
    pointRadius: 3,
    fill: false,
  }));

  new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 800 },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw.toLocaleString()} kWh` } },
      },
      scales: { y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString() + ' kWh' } } },
      interaction: { mode: 'index', intersect: false },
    },
  });
}

async function loadLotDetail(lotId) {
  const container = document.getElementById('lot-detail-content');
  if (!lotId) { container.innerHTML = ''; return; }

  const data = await API.get(`/electric/lot/${lotId}`);
  if (!data) return;

  container.innerHTML = `
    <div class="stats-grid" style="margin:1rem 0">
      <div class="stat-card"><div class="stat-value">${data.avgKwh.toLocaleString()}</div><div class="stat-label">Avg KWH/Month</div></div>
      <div class="stat-card success"><div class="stat-value">$${data.avgCharge.toFixed(2)}</div><div class="stat-label">Avg Bill/Month</div></div>
      <div class="stat-card danger"><div class="stat-value">${data.highestMonth ? data.highestMonth.kwh.toLocaleString() : '—'}</div><div class="stat-label">Highest: ${data.highestMonth?.ym || '—'}</div></div>
      <div class="stat-card"><div class="stat-value">${data.lowestMonth ? data.lowestMonth.kwh.toLocaleString() : '—'}</div><div class="stat-label">Lowest: ${data.lowestMonth?.ym || '—'}</div></div>
    </div>
    <div style="height:250px;margin-bottom:1rem"><canvas id="lotChart"></canvas></div>
    <div class="btn-group" style="margin:0.75rem 0" id="lot-export-buttons">
      <button class="btn btn-primary" onclick="downloadLotPdf('${lotId}')">📄 Download PDF</button>
      <button class="btn btn-success" onclick="textLotToTenant('${lotId}')">📱 Text to Tenant</button>
    </div>
    <div class="table-container" style="margin-top:1rem;max-height:250px" id="lot-readings-table">
      <table>
        <thead><tr><th>Date</th><th>Previous</th><th>Current</th><th>KWH</th><th>Rate</th><th>Charge</th></tr></thead>
        <tbody>
          ${data.readings.slice(0, 12).map(r => `
            <tr><td>${formatDate(r.reading_date)}</td><td>${r.previous_reading.toLocaleString()}</td><td>${r.current_reading.toLocaleString()}</td><td><strong>${r.kwh_used.toLocaleString()}</strong></td><td>$${Number(r.rate_per_kwh).toFixed(2)}</td><td><strong>${formatMoney(r.electric_charge)}</strong></td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  window._lotDetailData = data;
  window._lotDetailLotId = lotId;

  // Render lot bar chart
  setTimeout(() => {
    const ctx = document.getElementById('lotChart')?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.monthly.map(m => { const d = new Date(m.ym + '-15'); return d.toLocaleString('default', { month: 'short', year: '2-digit' }); }),
        datasets: [{ label: 'KWH Used', data: data.monthly.map(m => m.kwh), backgroundColor: '#1a5c3280', borderColor: '#1a5c32', borderWidth: 1, borderRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString() } } },
      },
    });
  }, 100);
}

async function downloadLotPdf(lotId) {
  const data = window._lotDetailData;
  if (!data) { alert('No data loaded. Select a lot first.'); return; }

  const tenant = data.readings[0] ? `${data.readings[0].first_name || ''} ${data.readings[0].last_name || ''}`.trim() : 'Unknown';
  const now = new Date();
  const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  const dateRange = data.readings.length
    ? `${formatDate(data.readings[data.readings.length - 1].reading_date)} — ${formatDate(data.readings[0].reading_date)}`
    : monthName;

  // Capture the chart as an image
  const chartCanvas = document.getElementById('lotChart');
  const chartImg = chartCanvas ? chartCanvas.toDataURL('image/png') : '';

  const readingsRows = data.readings.slice(0, 12).map(r => `
    <tr>
      <td>${formatDate(r.reading_date)}</td>
      <td style="text-align:right">${r.previous_reading.toLocaleString()}</td>
      <td style="text-align:right">${r.current_reading.toLocaleString()}</td>
      <td style="text-align:right"><strong>${r.kwh_used.toLocaleString()}</strong></td>
      <td style="text-align:right">$${Number(r.rate_per_kwh).toFixed(2)}</td>
      <td style="text-align:right"><strong>${formatMoney(r.electric_charge)}</strong></td>
    </tr>
  `).join('');

  const html = `
    <div id="electric-pdf-content" style="font-family:'Inter',sans-serif;color:#1c1917;padding:0.5rem;max-width:700px">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1a5c32;padding-bottom:0.75rem;margin-bottom:1rem">
        <div>
          <h1 style="font-size:1.25rem;color:#1a5c32;margin:0">Anahuac RV Park</h1>
          <p style="font-size:0.75rem;color:#78716c;margin:0.15rem 0 0">Electric Usage Report</p>
        </div>
        <div style="text-align:right;font-size:0.75rem;color:#78716c">
          <div>1003 Davis Ave, Anahuac, TX 77514</div>
          <div>409-267-6603</div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-bottom:1rem">
        <div>
          <p style="margin:0;font-size:0.85rem"><strong>Tenant:</strong> ${escapeHtml(tenant)}</p>
          <p style="margin:0.15rem 0 0;font-size:0.85rem"><strong>Lot:</strong> ${escapeHtml(lotId)}</p>
        </div>
        <div style="text-align:right">
          <p style="margin:0;font-size:0.85rem"><strong>Period:</strong> ${escapeHtml(dateRange)}</p>
          <p style="margin:0.15rem 0 0;font-size:0.85rem"><strong>Generated:</strong> ${now.toLocaleDateString()}</p>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0.6rem;margin-bottom:1.25rem">
        <div style="background:#f0fdf4;border:1px solid #dcfce7;border-radius:8px;padding:0.6rem;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#1a5c32">${data.avgKwh.toLocaleString()}</div>
          <div style="font-size:0.65rem;color:#78716c;text-transform:uppercase;letter-spacing:0.05em">Avg KWH/Mo</div>
        </div>
        <div style="background:#f0fdf4;border:1px solid #dcfce7;border-radius:8px;padding:0.6rem;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#1a5c32">$${data.avgCharge.toFixed(2)}</div>
          <div style="font-size:0.65rem;color:#78716c;text-transform:uppercase;letter-spacing:0.05em">Avg Bill/Mo</div>
        </div>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:0.6rem;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#92400e">${data.highestMonth ? data.highestMonth.kwh.toLocaleString() : '—'}</div>
          <div style="font-size:0.65rem;color:#78716c;text-transform:uppercase;letter-spacing:0.05em">Highest (${data.highestMonth?.ym || '—'})</div>
        </div>
        <div style="background:#e0f2fe;border:1px solid #bae6fd;border-radius:8px;padding:0.6rem;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#0284c7">${data.lowestMonth ? data.lowestMonth.kwh.toLocaleString() : '—'}</div>
          <div style="font-size:0.65rem;color:#78716c;text-transform:uppercase;letter-spacing:0.05em">Lowest (${data.lowestMonth?.ym || '—'})</div>
        </div>
      </div>

      ${chartImg ? `<div style="margin-bottom:1.25rem"><img src="${chartImg}" style="width:100%;border-radius:8px;border:1px solid #e7e5e4"></div>` : ''}

      <h3 style="font-size:0.85rem;color:#1a5c32;margin-bottom:0.5rem;border-left:3px solid #f59e0b;padding-left:0.5rem">Meter Readings</h3>
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem;margin-bottom:1.25rem">
        <thead>
          <tr style="background:#fafaf9;border-bottom:2px solid #e7e5e4">
            <th style="padding:0.4rem 0.35rem;text-align:left;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#57534e">Date</th>
            <th style="padding:0.4rem 0.35rem;text-align:right;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#57534e">Previous</th>
            <th style="padding:0.4rem 0.35rem;text-align:right;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#57534e">Current</th>
            <th style="padding:0.4rem 0.35rem;text-align:right;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#57534e">KWH</th>
            <th style="padding:0.4rem 0.35rem;text-align:right;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#57534e">Rate</th>
            <th style="padding:0.4rem 0.35rem;text-align:right;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#57534e">Charge</th>
          </tr>
        </thead>
        <tbody>${readingsRows}</tbody>
      </table>

      <div style="border-top:2px solid #1a5c32;padding-top:0.75rem;display:flex;justify-content:space-between;font-size:0.7rem;color:#78716c">
        <span>Questions? Call 409-267-6603</span>
        <span>&copy; 2026 Anahuac RV Park LLC</span>
      </div>
    </div>
  `;

  // Create a temporary element for html2pdf
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  const lotClean = lotId.replace(/[^a-zA-Z0-9]/g, '');
  const monthClean = now.toLocaleString('default', { month: 'long', year: 'numeric' }).replace(/\s/g, '');
  const filename = `Electric_Report_Lot${lotClean}_${monthClean}.pdf`;

  try {
    await html2pdf().set({
      margin: [0.4, 0.5, 0.4, 0.5],
      filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    }).from(wrapper.firstElementChild).save();
    showStatusToast('✅', 'PDF downloaded!');
  } catch (err) {
    alert('PDF generation failed: ' + (err.message || 'unknown'));
  } finally {
    document.body.removeChild(wrapper);
  }
}

async function textLotToTenant(lotId) {
  const data = window._lotDetailData;
  if (!data) { alert('No data loaded. Select a lot first.'); return; }

  // Find the tenant for this lot
  let tenants;
  try { tenants = await API.get('/tenants'); } catch { tenants = []; }
  const tenant = (tenants || []).find(t => t.lot_id === lotId);
  const tenantName = tenant ? `${tenant.first_name} ${tenant.last_name}` : 'Tenant';
  const tenantPhone = tenant?.phone || '(no phone on file)';

  const lastReading = data.readings[0];
  const lastKwh = lastReading ? lastReading.kwh_used.toLocaleString() : '—';
  const lastCharge = lastReading ? '$' + Number(lastReading.electric_charge).toFixed(2) : '—';

  const highLabel = data.highestMonth ? `${data.highestMonth.ym} - ${data.highestMonth.kwh.toLocaleString()} KWH ($${data.highestMonth.charge.toFixed(2)})` : 'N/A';
  const lowLabel = data.lowestMonth ? `${data.lowestMonth.ym} - ${data.lowestMonth.kwh.toLocaleString()} KWH ($${data.lowestMonth.charge.toFixed(2)})` : 'N/A';

  const message = `Hi ${tenant ? tenant.first_name : 'there'}! Here is your electric usage summary for Lot ${lotId}:\n` +
    `• Average usage: ${data.avgKwh.toLocaleString()} KWH/month ($${data.avgCharge.toFixed(2)})\n` +
    `• Last month: ${lastKwh} KWH (${lastCharge})\n` +
    `• Highest month: ${highLabel}\n` +
    `• Lowest month: ${lowLabel}\n` +
    `Questions? Call us at 409-267-6603\n` +
    `— Anahuac RV Park`;

  showModal('📱 Text Electric Summary', `
    <div style="margin-bottom:1rem">
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;background:var(--gray-50);border-radius:var(--radius);border:1px solid var(--gray-200)">
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#1a5c32,#2d8a52);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:0.85rem;flex-shrink:0">${escapeHtml(tenantName.split(' ').map(w => w[0] || '').join('').slice(0, 2))}</div>
        <div>
          <div style="font-weight:600;color:var(--gray-900)">${escapeHtml(tenantName)}</div>
          <div style="font-size:0.82rem;color:var(--gray-500)">📞 ${escapeHtml(tenantPhone)} &nbsp;·&nbsp; Lot ${escapeHtml(lotId)}</div>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>Message</label>
      <textarea id="sms-electric-text" rows="10" style="font-size:0.85rem">${escapeHtml(message)}</textarea>
    </div>
    ${!tenant?.phone ? '<p style="color:var(--danger);font-size:0.85rem;margin-bottom:0.75rem">⚠️ No phone number on file for this tenant. SMS cannot be sent.</p>' : ''}
    <button class="btn btn-success btn-full" onclick="sendElectricSms('${lotId}', ${tenant ? tenant.id : 'null'})" ${!tenant?.phone ? 'disabled' : ''}>📱 Send SMS</button>
  `);
}

async function sendElectricSms(lotId, tenantId) {
  if (!tenantId) { alert('No tenant found for this lot.'); return; }
  const text = document.getElementById('sms-electric-text')?.value;
  if (!text) return;
  try {
    const btn = document.querySelector('#modal-body .btn-success');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    await API.post('/messages', {
      tenant_id: tenantId,
      subject: 'Electric Usage Summary',
      body: text,
      message_type: 'notice',
      delivery_method: 'sms',
      is_broadcast: false,
    });
    closeModal();
    showStatusToast('✅', 'Electric summary texted to tenant!');
  } catch (err) {
    alert('SMS failed: ' + (err.message || 'unknown'));
    const btn = document.querySelector('#modal-body .btn-success');
    if (btn) { btn.disabled = false; btn.textContent = '📱 Send SMS'; }
  }
}
