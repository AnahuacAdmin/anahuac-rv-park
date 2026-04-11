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

async function fetchBibleVerse() {
  try {
    const r = await fetch('https://beta.ourmanna.com/api/v1/get?format=json&order=daily');
    const d = await r.json();
    return { verse: d.verse.details.text, reference: d.verse.details.reference };
  } catch (e) {
    const verses = [
      { verse: "I can do all things through Christ who strengthens me.", reference: "Philippians 4:13" },
      { verse: "The Lord is my shepherd; I shall not want.", reference: "Psalm 23:1" },
      { verse: "Trust in the Lord with all your heart.", reference: "Proverbs 3:5" },
      { verse: "For God so loved the world that he gave his one and only Son.", reference: "John 3:16" },
      { verse: "Be strong and courageous. Do not be afraid.", reference: "Joshua 1:9" },
      { verse: "The Lord is my light and my salvation; whom shall I fear?", reference: "Psalm 27:1" },
      { verse: "And we know that in all things God works for the good of those who love him.", reference: "Romans 8:28" },
    ];
    return verses[new Date().getDay() % verses.length];
  }
}

function arrivalCountdown(dateStr) {
  const now = new Date(); now.setHours(0,0,0,0);
  const arr = new Date(dateStr + 'T00:00:00');
  const days = Math.round((arr - now) / 86400000);
  if (days === 0) return { text: 'Today!', color: '#dc2626' };
  if (days === 1) return { text: 'Tomorrow', color: '#f59e0b' };
  if (days <= 7) return { text: `In ${days} days`, color: '#16a34a' };
  return { text: `In ${days} days`, color: '#6b7280' };
}

function initials(name) {
  return (name || '?').split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
}

async function loadDashboard() {
  const [data, weather, bibleVerse] = await Promise.all([API.get('/dashboard'), fetchWeather(), fetchBibleVerse()]);
  if (!data) return;

  const revTrend = data.lastMonthRevenue > 0
    ? ((data.monthlyRevenue - data.lastMonthRevenue) / data.lastMonthRevenue * 100).toFixed(0)
    : 0;
  const trendIcon = revTrend >= 0 ? '↑' : '↓';
  const trendColor = revTrend >= 0 ? '#16a34a' : '#dc2626';

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('dashboard')}

    <div class="page-header dash-fade-in" style="animation-delay:0.05s">
      <h2>${getTimeGreeting()}, ${API.user?.username || 'Admin'}!</h2>
    </div>

    <!-- Stats -->
    <div class="dash-top-bar">
      <div class="dash-top-item dash-fade-in dash-border-green" onclick="navigateTo('billing')" style="animation-delay:0.1s">
        <div class="dash-top-icon">💰</div>
        <span class="dash-top-val" data-count="${Math.round(data.monthlyRevenue)}">${formatMoney(data.monthlyRevenue)}</span>
        <span class="dash-top-label">Revenue This Month</span>
        <span class="dash-trend" style="color:${trendColor}">${trendIcon} ${Math.abs(revTrend)}%</span>
      </div>
      <div class="dash-top-item dash-fade-in dash-border-blue" onclick="navigateTo('sitemap')" style="animation-delay:0.15s">
        <div class="dash-top-icon">🏠</div>
        <span class="dash-top-val">${data.occupancyRate}%</span>
        <span class="dash-top-label">Occupancy</span>
        <span class="dash-trend" style="color:#2563eb">${data.occupied}/${data.totalLots - data.reserved} lots</span>
      </div>
      <div class="dash-top-item dash-fade-in dash-border-red" onclick="navigateTo('billing')" style="animation-delay:0.2s">
        <div class="dash-top-icon">⚠️</div>
        <span class="dash-top-val" style="color:#dc2626">${formatMoney(data.totalOutstanding)}</span>
        <span class="dash-top-label">Outstanding</span>
        <span class="dash-trend" style="color:#dc2626">${data.pendingInvoices + data.partialInvoices} invoices</span>
      </div>
      <div class="dash-top-item dash-fade-in dash-border-purple" onclick="navigateTo('tenants')" style="animation-delay:0.25s">
        <div class="dash-top-icon">👥</div>
        <span class="dash-top-val">${data.activeTenants}</span>
        <span class="dash-top-label">Active Tenants</span>
        <span class="dash-trend" style="color:#7c3aed">${data.pendingReservations} reservations</span>
      </div>
    </div>

    <!-- Charts -->
    <div class="dash-charts-row">
      <div class="card dash-chart-card dash-fade-in" style="animation-delay:0.3s">
        <h3>Revenue (Last 6 Months)</h3>
        <canvas id="revenueChart" height="220"></canvas>
      </div>
      <div class="card dash-chart-card dash-chart-small dash-fade-in" style="animation-delay:0.35s">
        <h3>Occupancy</h3>
        <div class="dash-donut-center">${data.occupancyRate}%</div>
        <canvas id="occupancyChart" height="200"></canvas>
      </div>
      <div class="card dash-chart-card dash-chart-small dash-fade-in" style="animation-delay:0.4s">
        <h3>Invoice Status</h3>
        <div class="dash-donut-center">${data.paidInvoices + data.pendingInvoices + data.partialInvoices}</div>
        <canvas id="invoiceChart" height="200"></canvas>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="dash-actions dash-fade-in" style="animation-delay:0.45s">
      <button class="dash-action-btn" onclick="navigateTo('meters')"><span class="dash-action-icon">⚡</span>Meter Readings</button>
      <button class="dash-action-btn" onclick="navigateTo('billing')"><span class="dash-action-icon">🧾</span>Invoices${data.pendingInvoices ? `<span class="dash-action-badge">${data.pendingInvoices}</span>` : ''}</button>
      <button class="dash-action-btn" onclick="navigateTo('payments')"><span class="dash-action-icon">💰</span>Payments</button>
      <button class="dash-action-btn" onclick="navigateTo('checkins')"><span class="dash-action-icon">🏕️</span>Check In</button>
      <button class="dash-action-btn" onclick="navigateTo('reservations')"><span class="dash-action-icon">📅</span>Reservations${data.pendingReservations ? `<span class="dash-action-badge">${data.pendingReservations}</span>` : ''}</button>
      <button class="dash-action-btn" onclick="navigateTo('messages')"><span class="dash-action-icon">📱</span>Messaging</button>
    </div>

    <!-- Bottom Row -->
    <div class="dash-bottom-row">
      <div class="card dash-fade-in" style="flex:2;animation-delay:0.5s">
        <h3>Recent Activity</h3>
        <div class="dash-activity">
          ${data.activity?.length ? data.activity.map(a => `
            <div class="dash-activity-item dash-activity-${a.type}">
              <span class="dash-activity-icon">${a.icon}</span>
              <div style="flex:1">
                <div class="dash-activity-text">${a.text}</div>
                <div class="dash-activity-date">${a.date || ''}</div>
              </div>
            </div>
          `).join('') : '<p style="color:var(--gray-500);padding:1rem">No recent activity</p>'}
        </div>
      </div>
      <div class="card dash-fade-in" style="flex:1;animation-delay:0.55s">
        <h3>Upcoming Reservations</h3>
        ${data.upcomingReservations?.length ? data.upcomingReservations.map(r => {
          const cd = arrivalCountdown(r.arrival_date);
          return `
          <div class="dash-reservation-item" onclick="navigateTo('reservations')">
            <div class="dash-res-avatar" style="background:${cd.color}20;color:${cd.color}">${initials(r.guest_name)}</div>
            <div style="flex:1">
              <strong>${r.guest_name}</strong>
              <div style="font-size:0.78rem;color:var(--gray-500)">Lot ${r.lot_id || '?'} · ${r.nights} nights</div>
            </div>
            <div class="dash-res-countdown" style="color:${cd.color}">${cd.text}</div>
          </div>`;
        }).join('') : '<p style="color:var(--gray-500);padding:1rem">No upcoming reservations</p>'}
      </div>
    </div>

    ${bibleVerse ? `
    <div class="dash-bible dash-fade-in" style="animation-delay:0.6s">
      <div class="dash-bible-label">✝️ Verse of the Day</div>
      <div class="dash-bible-text">"${bibleVerse.verse}"</div>
      <div class="dash-bible-ref">— ${bibleVerse.reference}</div>
    </div>` : ''}

    <div class="daily-tip dash-fade-in" style="animation-delay:0.65s">💡 ${getDailyTip().replace('💡 ', '')}</div>

    ${weather ? `
    <div class="dash-weather dash-fade-in" style="animation-delay:0.7s">
      <span>${weather.emoji} <strong>${weather.temp}°F</strong> ${weather.condition}</span>
      <span class="dash-weather-sep">|</span>
      <span class="dash-weather-detail">💨 ${weather.wind}mph</span>
      <span class="dash-weather-sep">|</span>
      <span class="dash-weather-detail">💧 ${weather.humidity}%</span>
      <span class="dash-weather-sep">|</span>
      <span class="dash-weather-detail">Anahuac, TX</span>
      <span class="dash-weather-sep">|</span>
      <span class="dash-weather-detail">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
    </div>` : ''}
  `;

  setTimeout(() => renderDashboardCharts(data), 150);
}

function renderDashboardCharts(data) {
  if (typeof Chart === 'undefined') return;

  // Revenue Bar Chart with gradient
  const revCtx = document.getElementById('revenueChart')?.getContext('2d');
  if (revCtx) {
    const greenGrad = revCtx.createLinearGradient(0, 0, 0, 220);
    greenGrad.addColorStop(0, '#16a34a'); greenGrad.addColorStop(1, '#86efac');
    const redGrad = revCtx.createLinearGradient(0, 0, 0, 220);
    redGrad.addColorStop(0, '#dc2626'); redGrad.addColorStop(1, '#fca5a5');
    new Chart(revCtx, {
      type: 'bar',
      data: {
        labels: data.revenueHistory.map(r => r.label),
        datasets: [
          { label: 'Collected', data: data.revenueHistory.map(r => r.collected), backgroundColor: greenGrad, borderRadius: 6 },
          { label: 'Outstanding', data: data.revenueHistory.map(r => r.outstanding), backgroundColor: redGrad, borderRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 1000, easing: 'easeOutQuart' },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, font: { size: 11 } } } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() }, grid: { color: '#f3f4f6' } }, x: { grid: { display: false } } },
        onClick: () => navigateTo('billing'),
      },
    });
  }

  // Occupancy Donut
  const occCtx = document.getElementById('occupancyChart')?.getContext('2d');
  if (occCtx) {
    new Chart(occCtx, {
      type: 'doughnut',
      data: {
        labels: ['Occupied', 'Vacant', 'Reserved'],
        datasets: [{ data: [data.occupied, data.vacant, data.reserved], backgroundColor: ['#2563eb', '#16a34a', '#9ca3af'], borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%',
        animation: { duration: 1200, easing: 'easeOutQuart' },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} lots` } } },
        onClick: () => navigateTo('sitemap'),
      },
    });
  }

  // Invoice Status Donut
  const invCtx = document.getElementById('invoiceChart')?.getContext('2d');
  if (invCtx) {
    new Chart(invCtx, {
      type: 'doughnut',
      data: {
        labels: ['Paid', 'Pending', 'Partial'],
        datasets: [{ data: [data.paidInvoices, data.pendingInvoices, data.partialInvoices], backgroundColor: ['#16a34a', '#f59e0b', '#dc2626'], borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%',
        animation: { duration: 1200, easing: 'easeOutQuart' },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } },
        onClick: () => navigateTo('billing'),
      },
    });
  }
}
