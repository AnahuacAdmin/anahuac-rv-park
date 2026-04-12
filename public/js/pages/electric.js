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

  const colors = ['#2563eb','#dc2626','#16a34a','#f59e0b','#7c3aed','#06b6d4','#f97316','#ec4899','#84cc16','#6366f1',
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
      <div class="stat-card"><div class="stat-value">${data.lowestMonth ? data.lowestMonth.kwh.toLocaleString() : '��'}</div><div class="stat-label">Lowest: ${data.lowestMonth?.ym || '—'}</div></div>
    </div>
    <div style="height:250px;margin-bottom:1rem"><canvas id="lotChart"></canvas></div>
    <button class="btn btn-outline btn-sm" onclick="shareLotSummary('${lotId}')">📤 Share with Tenant</button>
    <div class="table-container" style="margin-top:1rem;max-height:250px">
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

  // Render lot bar chart
  setTimeout(() => {
    const ctx = document.getElementById('lotChart')?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.monthly.map(m => { const d = new Date(m.ym + '-15'); return d.toLocaleString('default', { month: 'short', year: '2-digit' }); }),
        datasets: [{ label: 'KWH Used', data: data.monthly.map(m => m.kwh), backgroundColor: '#2563eb80', borderColor: '#2563eb', borderWidth: 1, borderRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString() } } },
      },
    });
  }, 100);
}

async function shareLotSummary(lotId) {
  const data = await API.get(`/electric/lot/${lotId}`);
  if (!data) return;
  const tenant = data.readings[0] ? `${data.readings[0].first_name || ''} ${data.readings[0].last_name || ''}`.trim() : '';
  const summary = `⚡ Lot ${lotId} Electric Usage Summary${tenant ? ' — ' + tenant : ''}
Avg: ${data.avgKwh.toLocaleString()} KWH/month ($${data.avgCharge.toFixed(2)})
Highest: ${data.highestMonth ? data.highestMonth.ym + ' — ' + data.highestMonth.kwh.toLocaleString() + ' KWH ($' + data.highestMonth.charge.toFixed(2) + ')' : 'N/A'}
Lowest: ${data.lowestMonth ? data.lowestMonth.ym + ' — ' + data.lowestMonth.kwh.toLocaleString() + ' KWH ($' + data.lowestMonth.charge.toFixed(2) + ')' : 'N/A'}
Recent: ${data.readings.slice(0, 3).map(r => r.reading_date + ': ' + r.kwh_used + ' KWH ($' + r.electric_charge.toFixed(2) + ')').join(', ')}
— Anahuac RV Park 409-267-6603`;

  showModal('📤 Share Electric Summary', `
    <p><strong>Lot ${lotId}</strong>${tenant ? ' — ' + tenant : ''}</p>
    <textarea id="share-summary-text" rows="8" style="width:100%;font-size:0.85rem;margin:0.75rem 0">${summary}</textarea>
    <div class="btn-group">
      <button class="btn btn-outline" onclick="navigator.clipboard?.writeText(document.getElementById('share-summary-text').value);showStatusToast('✅','Copied!')">📋 Copy</button>
      <button class="btn btn-success" onclick="smsLotSummary('${lotId}')">📱 Text to Tenant</button>
    </div>
  `);
}

async function smsLotSummary(lotId) {
  const text = document.getElementById('share-summary-text')?.value;
  if (!text) return;
  // Use the messaging system
  try {
    const tenants = await API.get('/tenants');
    const tenant = tenants?.find(t => t.lot_id === lotId);
    if (!tenant) { alert('No tenant found for this lot.'); return; }
    await API.post('/messages', { tenant_id: tenant.id, subject: 'Electric Usage Summary', body: text, message_type: 'notice', delivery_method: 'sms', is_broadcast: false });
    showStatusToast('✅', 'Summary texted to tenant!');
    const t = document.querySelector('.status-toast.visible');
    if (t) setTimeout(() => t.classList.remove('visible'), 3000);
    closeModal();
  } catch (err) { alert('SMS failed: ' + (err.message || 'unknown')); }
}
