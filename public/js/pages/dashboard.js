async function fetchWeather() {
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=29.7724&longitude=-94.6799&current=temperature_2m,weathercode,windspeed_10m,relative_humidity_2m&temperature_unit=fahrenheit&windspeed_unit=mph');
    const d = await r.json();
    const c = d.current;
    const code = c.weathercode;
    let emoji = '☀️', condition = 'Clear';
    if (code >= 1 && code <= 3) { emoji = '🌤️'; condition = 'Partly Cloudy'; }
    else if (code >= 45 && code <= 48) { emoji = '🌫️'; condition = 'Foggy'; }
    else if (code >= 51 && code <= 67) { emoji = '🌧️'; condition = 'Rainy'; }
    else if (code >= 71 && code <= 77) { emoji = '❄️'; condition = 'Snow'; }
    else if (code >= 80 && code <= 82) { emoji = '🌦️'; condition = 'Showers'; }
    else if (code >= 95) { emoji = '⛈️'; condition = 'Thunderstorm'; }
    return { temp: Math.round(c.temperature_2m), wind: Math.round(c.windspeed_10m), humidity: c.relative_humidity_2m, emoji, condition };
  } catch (e) { return null; }
}

async function loadDashboard() {
  const [data, weather] = await Promise.all([API.get('/dashboard'), fetchWeather()]);
  if (!data) return;

  const revTrend = data.lastMonthRevenue > 0
    ? ((data.monthlyRevenue - data.lastMonthRevenue) / data.lastMonthRevenue * 100).toFixed(0)
    : 0;
  const trendIcon = revTrend >= 0 ? '↑' : '↓';
  const trendColor = revTrend >= 0 ? '#16a34a' : '#dc2626';

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('dashboard')}
    ${weather ? `
    <div class="dash-weather">
      <div class="dash-weather-main">
        <span class="dash-weather-emoji">${weather.emoji}</span>
        <span class="dash-weather-temp">${weather.temp}°F</span>
        <span class="dash-weather-cond">${weather.condition}</span>
      </div>
      <div class="dash-weather-details">
        <span>💨 Wind: ${weather.wind} mph</span>
        <span>💧 Humidity: ${weather.humidity}%</span>
      </div>
      <div class="dash-weather-loc">
        <strong>Anahuac, TX</strong>
        <div>${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </div>
    </div>` : ''}
    <div class="page-header">
      <h2>${getTimeGreeting()}, ${API.user?.username || 'Admin'}!</h2>
    </div>

    <!-- Top Stats Bar -->
    <div class="dash-top-bar">
      <div class="dash-top-item" onclick="navigateTo('billing')">
        <span class="dash-top-val">${formatMoney(data.monthlyRevenue)}</span>
        <span class="dash-top-label">Revenue This Month</span>
        <span style="color:${trendColor};font-size:0.75rem;font-weight:700">${trendIcon} ${Math.abs(revTrend)}% vs last month</span>
      </div>
      <div class="dash-top-item" onclick="navigateTo('sitemap')">
        <span class="dash-top-val">${data.occupancyRate}%</span>
        <span class="dash-top-label">Occupancy</span>
      </div>
      <div class="dash-top-item" onclick="navigateTo('billing')" style="color:#dc2626">
        <span class="dash-top-val">${formatMoney(data.totalOutstanding)}</span>
        <span class="dash-top-label">Outstanding</span>
      </div>
      <div class="dash-top-item" onclick="navigateTo('checkins')">
        <span class="dash-top-val">${data.activeTenants}</span>
        <span class="dash-top-label">Active Tenants</span>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="dash-charts-row">
      <div class="card dash-chart-card">
        <h3>Revenue (Last 6 Months)</h3>
        <canvas id="revenueChart" height="200"></canvas>
      </div>
      <div class="card dash-chart-card dash-chart-small">
        <h3>Occupancy</h3>
        <canvas id="occupancyChart" height="200"></canvas>
      </div>
      <div class="card dash-chart-card dash-chart-small">
        <h3>Invoice Status</h3>
        <canvas id="invoiceChart" height="200"></canvas>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="dash-actions">
      <button class="dash-action-btn" onclick="navigateTo('meters')"><span class="dash-action-icon">⚡</span>Meter Readings</button>
      <button class="dash-action-btn" onclick="navigateTo('billing')"><span class="dash-action-icon">🧾</span>Invoices</button>
      <button class="dash-action-btn" onclick="navigateTo('payments')"><span class="dash-action-icon">💰</span>Payments</button>
      <button class="dash-action-btn" onclick="navigateTo('checkins')"><span class="dash-action-icon">🏕️</span>Check In</button>
      <button class="dash-action-btn" onclick="navigateTo('reservations')"><span class="dash-action-icon">📅</span>Reservations</button>
      <button class="dash-action-btn" onclick="navigateTo('messages')"><span class="dash-action-icon">📱</span>Messaging</button>
    </div>

    <!-- Bottom Row: Activity + Upcoming -->
    <div class="dash-bottom-row">
      <div class="card" style="flex:2">
        <h3>Recent Activity</h3>
        <div class="dash-activity">
          ${data.activity?.length ? data.activity.map(a => `
            <div class="dash-activity-item">
              <span class="dash-activity-icon">${a.icon}</span>
              <div>
                <div class="dash-activity-text">${a.text}</div>
                <div class="dash-activity-date">${a.date || ''}</div>
              </div>
            </div>
          `).join('') : '<p style="color:var(--gray-500);padding:1rem">No recent activity</p>'}
        </div>
      </div>
      <div class="card" style="flex:1">
        <h3>Upcoming Reservations</h3>
        ${data.upcomingReservations?.length ? data.upcomingReservations.map(r => `
          <div class="dash-reservation-item" onclick="navigateTo('reservations')">
            <strong>${r.guest_name}</strong>
            <div style="font-size:0.8rem;color:var(--gray-500)">Lot ${r.lot_id || '?'} · ${formatDate(r.arrival_date)} · ${r.nights} nights</div>
          </div>
        `).join('') : '<p style="color:var(--gray-500);padding:1rem">No upcoming reservations</p>'}
      </div>
    </div>

    <div class="daily-tip">${getDailyTip()}</div>
  `;

  // Render charts after DOM
  setTimeout(() => renderDashboardCharts(data), 100);
}

function renderDashboardCharts(data) {
  // Revenue Bar Chart
  const revCtx = document.getElementById('revenueChart')?.getContext('2d');
  if (revCtx && typeof Chart !== 'undefined') {
    new Chart(revCtx, {
      type: 'bar',
      data: {
        labels: data.revenueHistory.map(r => r.label),
        datasets: [
          { label: 'Collected', data: data.revenueHistory.map(r => r.collected), backgroundColor: '#16a34a', borderRadius: 4 },
          { label: 'Outstanding', data: data.revenueHistory.map(r => r.outstanding), backgroundColor: '#dc2626', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } },
        onClick: (e, els) => { if (els.length) navigateTo('billing'); },
      },
    });
  }

  // Occupancy Donut
  const occCtx = document.getElementById('occupancyChart')?.getContext('2d');
  if (occCtx && typeof Chart !== 'undefined') {
    new Chart(occCtx, {
      type: 'doughnut',
      data: {
        labels: ['Occupied', 'Vacant', 'Reserved'],
        datasets: [{ data: [data.occupied, data.vacant, data.reserved], backgroundColor: ['#2563eb', '#16a34a', '#9ca3af'], borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} lots` } },
        },
        onClick: () => navigateTo('sitemap'),
      },
    });
  }

  // Invoice Status Donut
  const invCtx = document.getElementById('invoiceChart')?.getContext('2d');
  if (invCtx && typeof Chart !== 'undefined') {
    new Chart(invCtx, {
      type: 'doughnut',
      data: {
        labels: ['Paid', 'Pending', 'Partial'],
        datasets: [{ data: [data.paidInvoices, data.pendingInvoices, data.partialInvoices], backgroundColor: ['#16a34a', '#f59e0b', '#dc2626'], borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
        onClick: () => navigateTo('billing'),
      },
    });
  }
}
