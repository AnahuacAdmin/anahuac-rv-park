/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
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

function isAdmin() { return API.user?.role === 'admin'; }

async function loadDashboard() {
  const el = document.getElementById('page-content');
  if (el) el.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;padding:3rem"><div class="loading-spinner"></div></div>';
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
      ${isAdmin() ? '<button class="btn btn-danger" style="font-size:0.85rem" onclick="showEmergencyBroadcast()" title="Send emergency SMS to ALL tenants immediately. Use only for real emergencies.">🚨 Emergency Alert</button>' : ''}
    </div>

    <div id="dash-weather-alert-banner"></div>

    <!-- Stats -->
    <div class="dash-top-bar">
      ${isAdmin() ? `
      <div class="dash-top-item dash-fade-in dash-border-green" onclick="navigateTo('billing')" style="animation-delay:0.1s">
        <div class="dash-top-icon">💰</div>
        <span class="dash-top-val">${formatMoney(data.monthlyRevenue)}</span>
        <span class="dash-top-label">Revenue This Month</span>
        <span class="dash-trend" style="color:${trendColor}">${trendIcon} ${Math.abs(revTrend)}%</span>
      </div>` : ''}
      <div class="dash-top-item dash-fade-in dash-border-blue" onclick="navigateTo('sitemap')" style="animation-delay:0.15s">
        <div class="dash-top-icon">🏠</div>
        <span class="dash-top-val">${data.occupancyRate}%</span>
        <span class="dash-top-label">Occupancy</span>
        <span class="dash-trend" style="color:#0284c7">${data.occupied}/${data.totalLots - data.reserved} lots</span>
      </div>
      ${isAdmin() ? `
      <div class="dash-top-item dash-fade-in dash-border-red" onclick="navigateTo('billing')" style="animation-delay:0.2s">
        <div class="dash-top-icon">⚠️</div>
        <span class="dash-top-val" style="color:#dc2626">${formatMoney(data.totalOutstanding)}</span>
        <span class="dash-top-label">Outstanding</span>
        <span class="dash-trend" style="color:#dc2626">${data.pendingInvoices + data.partialInvoices} invoices</span>
      </div>` : ''}
      <div class="dash-top-item dash-fade-in dash-border-purple" onclick="navigateTo('${isAdmin() ? 'tenants' : 'checkins'}')" style="animation-delay:0.25s">
        <div class="dash-top-icon">👥</div>
        <span class="dash-top-val">${data.activeTenants}</span>
        <span class="dash-top-label">Active Tenants</span>
        <span class="dash-trend" style="color:#7c3aed">${data.pendingReservations} reservations</span>
      </div>
    </div>

    <!-- Charts (admin only) -->
    ${isAdmin() ? `
    <div class="dash-charts-row">
      <div class="card dash-chart-card dash-fade-in" style="animation-delay:0.3s">
        <h3>Revenue (Last 6 Months)</h3>
        <div style="position:relative;height:220px"><canvas id="revenueChart"></canvas></div>
      </div>
      <div class="card dash-chart-card dash-chart-small dash-fade-in" style="animation-delay:0.35s">
        <h3>Occupancy</h3>
        <div style="position:relative;height:200px">
          <div class="dash-donut-center">${data.occupancyRate}%</div>
          <canvas id="occupancyChart"></canvas>
        </div>
      </div>
      <div class="card dash-chart-card dash-chart-small dash-fade-in" style="animation-delay:0.4s">
        <h3>Invoice Status</h3>
        <div style="position:relative;height:200px">
          <div class="dash-donut-center">${data.paidInvoices + data.pendingInvoices + data.partialInvoices}</div>
          <canvas id="invoiceChart"></canvas>
        </div>
      </div>
    </div>` : ''}

    <!-- Quick Actions -->
    <div class="dash-actions dash-fade-in" style="animation-delay:0.45s">
      <button class="dash-action-btn" onclick="navigateTo('meters')"><span class="dash-action-icon">⚡</span>Meter Readings</button>
      <button class="dash-action-btn" onclick="navigateTo('electric')"><span class="dash-action-icon">📊</span>Electric Analytics</button>
      ${isAdmin() ? `<button class="dash-action-btn" onclick="navigateTo('billing')"><span class="dash-action-icon">🧾</span>Invoices${data.pendingInvoices ? `<span class="dash-action-badge">${data.pendingInvoices}</span>` : ''}</button>` : ''}
      ${isAdmin() ? `<button class="dash-action-btn" onclick="navigateTo('reports')"><span class="dash-action-icon">📊</span>Monthly Report</button>` : ''}
      ${isAdmin() ? `<button class="dash-action-btn" onclick="navigateTo('payments')"><span class="dash-action-icon">💰</span>Payments</button>` : ''}
      <button class="dash-action-btn" onclick="navigateTo('checkins')"><span class="dash-action-icon">🏕️</span>Check In</button>
      <button class="dash-action-btn" onclick="navigateTo('reservations')"><span class="dash-action-icon">📅</span>Reservations${data.pendingReservations ? `<span class="dash-action-badge">${data.pendingReservations}</span>` : ''}</button>
      <button class="dash-action-btn" onclick="navigateTo('messages')"><span class="dash-action-icon">📱</span>Messaging</button>
      <a class="dash-action-btn dash-portal-btn" href="/portal.html" target="_blank" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#0d1a50;border:2px solid #d97706;text-decoration:none">
        <span class="dash-action-icon" style="font-size:2rem">🐊</span>
        <span style="font-weight:700;font-size:0.85rem">Tenant Portal</span>
        <span style="font-size:0.68rem;font-weight:400;opacity:0.8">View &amp; Pay Bills ↗</span>
      </a>
    </div>
    <div style="text-align:center;margin:-0.75rem 0 1rem;font-size:0.8rem;color:var(--gray-500)">
      Portal Link: <code style="background:var(--gray-100);padding:2px 6px;border-radius:4px;font-size:0.75rem">${APP_URL}/portal.html</code>
      <button class="btn btn-sm btn-outline" style="margin-left:0.4rem;padding:0.2rem 0.5rem;font-size:0.7rem;border-radius:6px" onclick="navigator.clipboard?.writeText('${APP_URL}/portal.html').then(()=>showStatusToast('✅','Portal link copied!'))">📋 Copy</button>
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

    ${isAdmin() ? `
    <div class="card dash-fade-in" style="animation-delay:0.7s">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <h3>🖥️ System Health</h3>
        <div style="display:flex;align-items:center;gap:0.5rem">
          <span id="health-time" style="font-size:0.75rem;color:var(--gray-500)"></span>
          <button class="btn btn-sm btn-outline" onclick="refreshHealth()">🔄</button>
        </div>
      </div>
      <div id="health-alert" style="display:none"></div>
      <div id="health-cards" style="display:flex;gap:0.6rem;flex-wrap:wrap">
        <div style="color:var(--gray-500);font-size:0.85rem">Loading...</div>
      </div>
      <div id="health-alert-history"></div>
    </div>` : ''}

    ${isAdmin() ? `
    <div class="card dash-fade-in" style="animation-delay:0.75s">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
        <h3>📒 Quick Contacts</h3>
        <a href="#" onclick="event.preventDefault();navigateTo('vendors')" style="font-size:0.78rem;color:var(--brand-primary);font-weight:600">View All →</a>
      </div>
      <div id="dash-vendors" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
    </div>` : ''}

    ${isAdmin() ? `
    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;width:100%;max-width:100%">
      <div class="card dash-fade-in" style="flex:1;min-width:200px;animation-delay:0.8s">
        <h3>💰 Deposit Summary</h3>
        <div id="dash-deposits" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
      </div>
      <div class="card dash-fade-in" style="flex:1;min-width:200px;animation-delay:0.82s">
        <h3>🔧 Maintenance</h3>
        <div id="dash-maintenance" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
      </div>
      <div class="card dash-fade-in" style="flex:1;min-width:200px;animation-delay:0.84s">
        <h3>💸 Expenses</h3>
        <div id="dash-expenses" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
      </div>
    </div>` : ''}

    ${isAdmin() ? `
    <div class="card dash-fade-in" style="animation-delay:0.86s">
      <h3>🏥 Park Health Score</h3>
      <div id="dash-health-score" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
    </div>

    <div class="card dash-fade-in" style="animation-delay:0.87s">
      <h3>⚡ Electric Alerts</h3>
      <div id="dash-electric-alerts" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
    </div>

    <div class="card dash-fade-in" style="animation-delay:0.88s">
      <h3>🏠 Vacancy Cost</h3>
      <div id="dash-vacancy-cost" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
    </div>` : ''}

    <div class="card dash-fade-in" style="animation-delay:0.88s">
      <button id="calc-toggle-btn" style="width:100%;background:none;border:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:0">
        <h3 style="margin:0">🧮 Quick Calculator</h3>
        <span id="calc-toggle-icon" style="color:var(--gray-400);font-size:0.8rem">tap to expand ▼</span>
      </button>
      <div id="calc-body" style="display:none;margin-top:0.75rem">
        <div id="calc-expr" style="text-align:right;font-size:0.78rem;color:var(--gray-400);min-height:1rem;overflow:hidden"></div>
        <div id="calc-display" style="text-align:right;font-size:2.5rem;font-weight:800;color:var(--gray-900);padding:0.25rem 0;min-height:3rem;overflow:hidden;font-variant-numeric:tabular-nums">0</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:0.5rem" id="calc-keys"></div>
      </div>
    </div>

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

    <div class="dash-fade-in" style="display:flex;gap:0.75rem;align-items:center;justify-content:center;flex-wrap:wrap;margin-bottom:0.75rem;font-size:0.8rem;animation-delay:0.75s">
      <span style="display:flex;align-items:center;gap:4px" id="connection-indicator">${navigator.onLine ? '🟢 Online' : '🔴 Offline'}</span>
      <span style="color:var(--gray-400)">|</span>
      <span style="color:var(--gray-500)">Last sync: <span id="sync-status">—</span></span>
      <button class="btn btn-sm btn-outline" style="padding:0.2rem 0.6rem;font-size:0.72rem;border-radius:6px" onclick="if(typeof syncPendingRecords==='function')syncPendingRecords()">🔄 Sync Now</button>
      <span style="color:var(--gray-400)">|</span>
      <a href="/emergency-form.html" target="_blank" style="color:var(--brand-primary,#1a5c32);font-weight:600;text-decoration:none">🖨️ Emergency Forms</a>
    </div>
  `;

  waitForChartAndRender(data);
  loadDashWeatherBanner();

  // Count-up animation for stat values
  setTimeout(() => {
    document.querySelectorAll('.dash-top-val').forEach(el => {
      const text = el.textContent.trim();
      const isPercent = text.endsWith('%');
      const isMoney = text.startsWith('$');
      let target = parseFloat(text.replace(/[$,%]/g, ''));
      if (isNaN(target) || target === 0) return;
      const duration = 800;
      const start = performance.now();
      const fmt = (v) => {
        if (isMoney) return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        if (isPercent) return Math.round(v) + '%';
        return Math.round(v).toString();
      };
      el.textContent = fmt(0);
      const animate = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = fmt(target * eased);
        if (progress < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    });
  }, 200);

  // Health monitor (admin only)
  if (isAdmin()) {
    refreshHealth();
    clearInterval(window._healthInterval);
    window._healthInterval = setInterval(refreshHealth, 5 * 60 * 1000);
    // Load dashboard widgets
    loadDashVendors();
    loadDashDeposits();
    loadDashMaintenance();
    loadDashExpenses();
    loadDashHealthScore();
    loadDashElectricAlerts();
    loadDashVacancyCost();
    loadDashCommunity();
  }

  // Init calculator
  initCalc();
}

async function loadDashDeposits() {
  var el = document.getElementById('dash-deposits');
  if (!el) return;
  try {
    var tenants = await API.get('/tenants');
    var paid = (tenants || []).filter(function(t) { return Number(t.deposit_amount) > 0; }).length;
    var waived = (tenants || []).filter(function(t) { return t.deposit_waived; }).length;
    var none = (tenants || []).length - paid - waived;
    el.innerHTML = '<div style="display:flex;gap:1rem;flex-wrap:wrap">' +
      '<span>💰 <strong>' + paid + '</strong> paid</span>' +
      '<span>🚫 <strong>' + waived + '</strong> waived</span>' +
      '<span style="color:#d97706">⚠️ <strong>' + none + '</strong> not recorded</span>' +
    '</div>';
  } catch { el.innerHTML = ''; }
}

async function loadDashHealthScore() {
  var el = document.getElementById('dash-health-score');
  if (!el) return;
  try {
    var data = await API.get('/tenants/scores');
    var avg = data?.averageScore || 0;
    var emoji = avg >= 80 ? '🟢' : avg >= 60 ? '🟡' : avg >= 40 ? '🟠' : '🔴';
    var atRisk = (data?.tenants || []).filter(function(t) { return t.score < 40; }).length;
    el.innerHTML = '<div style="display:flex;align-items:center;gap:0.75rem">' +
      '<span style="font-size:1.5rem;font-weight:800;color:' + (avg >= 80 ? '#16a34a' : avg >= 60 ? '#f59e0b' : '#dc2626') + '">' + avg + '</span>' +
      '<span>' + emoji + ' Average</span>' +
      (atRisk > 0 ? '<span style="color:#dc2626">🔴 ' + atRisk + ' at risk</span>' : '') +
    '</div>';
  } catch { el.innerHTML = ''; }
}

async function loadDashCommunity() {
  try {
    var posts = await API.get('/community');
    var pending = (posts || []).filter(function(p) { return p.status === 'pending'; }).length;
    if (pending > 0) {
      var widget = document.createElement('div');
      widget.className = 'card';
      widget.style.cssText = 'border-left:4px solid #f59e0b;padding:0.6rem 1rem;margin-bottom:0.75rem';
      widget.innerHTML = '<strong style="color:#d97706">📋 ' + pending + ' community post' + (pending > 1 ? 's' : '') + ' pending approval</strong> <a href="#" onclick="event.preventDefault();navigateTo(\'community\')" style="margin-left:0.5rem;font-size:0.82rem;color:var(--brand-primary)">Review →</a>';
      var content = document.getElementById('page-content');
      if (content && content.firstChild) content.insertBefore(widget, content.firstChild.nextSibling);
    }
  } catch {}
}

async function loadDashElectricAlerts() {
  var el = document.getElementById('dash-electric-alerts');
  if (!el) return;
  try {
    var alerts = await API.get('/electric-alerts');
    if (!alerts || !alerts.length) { el.innerHTML = '✅ No alerts'; return; }
    el.innerHTML = alerts.slice(0, 3).map(function(a) {
      return '<div style="padding:0.25rem 0;border-bottom:1px solid var(--gray-100);font-size:0.82rem">' +
        '<span style="color:#d97706">⚠️</span> ' + escapeHtml(a.message).slice(0, 80) +
        ' <button class="btn btn-sm btn-outline" style="font-size:0.65rem;padding:1px 6px" onclick="dismissElectricAlert(' + a.id + ')">Dismiss</button></div>';
    }).join('') + (alerts.length > 3 ? '<div style="font-size:0.75rem;color:#78716c;margin-top:0.25rem">+' + (alerts.length - 3) + ' more</div>' : '');
  } catch { el.innerHTML = ''; }
}

async function dismissElectricAlert(id) {
  await API.put('/electric-alerts/' + id + '/dismiss', {});
  loadDashElectricAlerts();
}

async function loadDashVacancyCost() {
  var el = document.getElementById('dash-vacancy-cost');
  if (!el) return;
  try {
    var data = await API.get('/dashboard/vacancy-cost');
    el.innerHTML = '<span>This month: <strong style="color:#dc2626">' + formatMoney(data?.totalCost || 0) + '</strong> lost</span>' +
      (data?.vacantLots?.length ? '<div style="font-size:0.75rem;color:#78716c;margin-top:0.25rem">' + data.vacantLots.slice(0, 3).map(function(v) { return v.lot_id + ': ' + v.daysVacant + ' days'; }).join(', ') + '</div>' : '');
  } catch { el.innerHTML = ''; }
}

async function loadDashMaintenance() {
  var el = document.getElementById('dash-maintenance');
  if (!el) return;
  try {
    var reqs = await API.get('/maintenance');
    var open = (reqs || []).filter(function(r) { return r.status !== 'resolved'; }).length;
    el.innerHTML = '<span>' + (open > 0 ? '⚠️' : '✅') + ' <strong>' + open + '</strong> open requests</span>' +
      ' <a href="#" onclick="event.preventDefault();navigateTo(\'maintenance\')" style="font-size:0.78rem;color:var(--brand-primary)">View →</a>';
  } catch { el.innerHTML = ''; }
}

async function loadDashExpenses() {
  var el = document.getElementById('dash-expenses');
  if (!el) return;
  try {
    var summary = await API.get('/expenses/summary');
    el.innerHTML = '<span>This month: <strong>' + formatMoney(summary?.total || 0) + '</strong></span>' +
      ' <a href="#" onclick="event.preventDefault();navigateTo(\'expenses\')" style="font-size:0.78rem;color:var(--brand-primary)">View →</a>';
  } catch { el.innerHTML = ''; }
}

function showEmergencyBroadcast() {
  var templates = [
    { icon: '🌀', label: 'Hurricane Warning', msg: 'HURRICANE WARNING: Please secure your RV immediately and move inside. Contact management at 409-267-6603.' },
    { icon: '🔥', label: 'Fire Alert', msg: 'FIRE ALERT: Please evacuate immediately. Call 911. Meet at the front office.' },
    { icon: '💧', label: 'Water Shutoff', msg: 'WATER SHUTOFF: Water will be off today for maintenance. We apologize for the inconvenience.' },
    { icon: '⚡', label: 'Power Outage', msg: 'POWER OUTAGE: We are aware of the outage and working to restore power. Updates coming.' },
    { icon: '🌊', label: 'Flood Warning', msg: 'FLOOD WARNING: Please move vehicles to higher ground immediately. Contact 409-267-6603.' },
  ];
  showModal('🚨 Emergency Alert', '<div style="background:#fee2e2;border:2px solid #dc2626;border-radius:8px;padding:0.75rem;margin-bottom:1rem;color:#991b1b;font-weight:600">⚠️ This will send an SMS to ALL tenants with phone numbers. This cannot be undone.</div>' +
    '<div class="form-group"><label>Select Template</label><select id="emergency-template" style="font-size:1rem">' +
      templates.map(function(t, i) { return '<option value="' + i + '">' + t.icon + ' ' + t.label + '</option>'; }).join('') +
      '<option value="custom">✏️ Custom Message</option></select></div>' +
    '<div class="form-group"><label>Message</label><textarea id="emergency-msg" rows="4" style="font-size:1rem">' + escapeHtml(templates[0].msg) + '</textarea></div>' +
    '<button class="btn btn-danger btn-full" id="btn-send-emergency" style="font-size:1.1rem;padding:1rem">🚨 SEND TO ALL TENANTS NOW</button>');
  setTimeout(function() {
    var sel = document.getElementById('emergency-template');
    var msg = document.getElementById('emergency-msg');
    if (sel) sel.addEventListener('change', function() {
      var idx = parseInt(this.value);
      if (!isNaN(idx) && templates[idx]) msg.value = templates[idx].msg;
      else msg.value = '';
    });
    var btn = document.getElementById('btn-send-emergency');
    if (btn) btn.addEventListener('click', async function() {
      if (!confirm('CONFIRM: Send this emergency alert to ALL tenants?')) return;
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        var r = await API.post('/messages/broadcast-advanced', {
          message_type: 'Emergency',
          recipients: 'all',
          delivery: 'sms',
          subject: 'Emergency Alert',
          message: msg.value,
        });
        closeModal();
        showStatusToast('🚨', 'Emergency alert sent to ' + (r.smsSent || 0) + ' tenants');
      } catch (err) { alert('Failed: ' + (err.message || 'unknown')); btn.disabled = false; btn.textContent = '🚨 SEND TO ALL TENANTS NOW'; }
    });
  }, 50);
}

async function loadDashVendors() {
  const el = document.getElementById('dash-vendors');
  if (!el) return;
  try {
    const vendors = await API.get('/vendors');
    const favs = (vendors || []).filter(v => v.is_favorite).slice(0, 3);
    if (!favs.length) { el.innerHTML = '<span style="color:var(--gray-400)">No favorite vendors yet. <a href="#" onclick="event.preventDefault();navigateTo(\'vendors\')">Add some →</a></span>'; return; }
    el.innerHTML = favs.map(v =>
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid var(--gray-100)">' +
        '<span><strong>' + escapeHtml(v.name) + '</strong> <span class="badge badge-info" style="font-size:0.6rem">' + escapeHtml(v.category || '') + '</span></span>' +
        (v.phone ? '<a href="tel:' + escapeHtml(v.phone) + '" class="btn btn-sm btn-success" style="padding:0.2rem 0.5rem;font-size:0.72rem" onclick="event.stopPropagation()">📞 Call</a>' : '') +
      '</div>'
    ).join('');
  } catch { el.innerHTML = ''; }
}

const _healthIcons = { 'Database': '🗄️', 'Stripe': '💳', 'Twilio': '📱', 'Internet': '🌐', 'Railway App': '🚂' };
const _healthLinks = { 'Database': 'https://railway.app/dashboard', 'Stripe': 'https://dashboard.stripe.com', 'Twilio': 'https://console.twilio.com', 'Internet': 'https://downdetector.com', 'Railway App': 'https://railway.app/dashboard' };
const _healthDots = { ok: '🟢', warning: '🟡', error: '🔴' };

async function refreshHealth() {
  const cardsEl = document.getElementById('health-cards');
  const alertEl = document.getElementById('health-alert');
  const timeEl = document.getElementById('health-time');
  if (!cardsEl) return;

  try {
    const r = await API.get('/health/status');
    if (!r?.services) return;

    // Render cards
    cardsEl.innerHTML = r.services.map(s => `
      <div class="health-card health-${s.status}">
        <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.25rem">
          <span>${_healthIcons[s.name] || '⚙️'}</span>
          <span>${_healthDots[s.status] || '⚪'}</span>
          <strong style="font-size:0.8rem">${s.name}</strong>
        </div>
        <div style="font-size:0.75rem;color:var(--gray-500)">${s.message}</div>
        <div style="font-size:0.65rem;color:var(--gray-500);margin-top:0.15rem">${s.responseTime}ms</div>
        ${_healthLinks[s.name] ? `<a href="${_healthLinks[s.name]}" target="_blank" style="font-size:0.65rem;color:#9ca3af;text-decoration:none">Open Dashboard →</a>` : ''}
      </div>
    `).join('');

    // Alerts
    const errors = r.services.filter(s => s.status === 'error');
    const warnings = r.services.filter(s => s.status === 'warning');
    let alertHtml = '';
    if (errors.length) alertHtml += errors.map(s => `<div style="background:#fee2e2;color:#991b1b;padding:0.5rem 0.75rem;border-radius:6px;margin-bottom:0.4rem;font-size:0.85rem">🔴 <strong>${s.name}</strong> is unavailable — ${s.message}</div>`).join('');
    if (warnings.length) alertHtml += warnings.map(s => `<div style="background:#fef3c7;color:#92400e;padding:0.5rem 0.75rem;border-radius:6px;margin-bottom:0.4rem;font-size:0.85rem">⚠️ <strong>${s.name}</strong>: ${s.message}</div>`).join('');
    alertEl.style.display = alertHtml ? '' : 'none';
    alertEl.innerHTML = alertHtml;

    if (timeEl) timeEl.textContent = 'Checked ' + new Date().toLocaleTimeString();

    // Show recent alerts if any
    const alertHistEl = document.getElementById('health-alert-history');
    if (alertHistEl && r.recentAlerts?.length) {
      alertHistEl.innerHTML = `<div style="font-size:0.75rem;font-weight:600;color:var(--gray-600);margin:0.5rem 0 0.3rem">Recent Alerts</div>` +
        r.recentAlerts.slice(0, 5).map(a => `<div style="font-size:0.72rem;color:var(--gray-500);padding:2px 0;border-bottom:1px solid var(--gray-100)">${a.resolved_at ? '✅' : '🔴'} <strong>${a.service}</strong> ${a.message || ''} <span style="color:var(--gray-400)">${a.alerted_at}${a.resolved_at ? ' → ' + a.resolved_at : ''}</span></div>`).join('');
    } else if (alertHistEl) {
      alertHistEl.innerHTML = '';
    }
  } catch {
    cardsEl.innerHTML = '<div style="color:var(--gray-500);font-size:0.85rem">Health check failed</div>';
  }
}

function waitForChartAndRender(data, attempts) {
  attempts = attempts || 0;
  if (typeof Chart !== 'undefined') {
    console.log('[charts] Chart.js ready (v' + Chart.version + '), rendering...');
    doRenderCharts(data);
    return;
  }
  if (attempts >= 20) {
    console.error('[charts] Chart.js never loaded after 10s');
    var target = document.querySelector('.dash-charts-row');
    if (target) target.innerHTML = '<div class="card" style="padding:2rem;text-align:center;color:#dc2626"><strong>Charts unavailable</strong><br>Chart.js failed to load. Try refreshing the page.</div>';
    return;
  }
  console.log('[charts] waiting... attempt ' + (attempts + 1));
  setTimeout(function() { waitForChartAndRender(data, attempts + 1); }, 500);
}

function doRenderCharts(data) {
  try {
    var revCanvas = document.getElementById('revenueChart');
    if (!revCanvas) {
      console.log('[charts] no canvas — isAdmin=' + isAdmin() + ' role=' + (API.user && API.user.role));
      return;
    }

    // Revenue Bar Chart
    revCanvas.parentElement.style.height = '220px';
    revCanvas.parentElement.style.position = 'relative';
    new Chart(revCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: (data.revenueHistory || []).map(function(r) { return r.label || ''; }),
        datasets: [
          { label: 'Collected', data: (data.revenueHistory || []).map(function(r) { return r.collected || 0; }), backgroundColor: '#1a5c32', borderRadius: 4 },
          { label: 'Outstanding', data: (data.revenueHistory || []).map(function(r) { return r.outstanding || 0; }), backgroundColor: '#dc2626', borderRadius: 4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return '$' + v.toLocaleString(); } } } } }
    });

    // Occupancy Donut
    var occCanvas = document.getElementById('occupancyChart');
    if (occCanvas) {
      occCanvas.parentElement.style.height = '200px';
      occCanvas.parentElement.style.position = 'relative';
      new Chart(occCanvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['Occupied', 'Vacant', 'Reserved'], datasets: [{ data: [data.occupied || 0, data.vacant || 0, data.reserved || 0], backgroundColor: ['#1a5c32', '#f59e0b', '#a8a29e'], borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }
      });
    }

    // Invoice Status Donut
    var invCanvas = document.getElementById('invoiceChart');
    if (invCanvas) {
      invCanvas.parentElement.style.height = '200px';
      invCanvas.parentElement.style.position = 'relative';
      new Chart(invCanvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['Paid', 'Pending', 'Partial'], datasets: [{ data: [data.paidInvoices || 0, data.pendingInvoices || 0, data.partialInvoices || 0], backgroundColor: ['#16a34a', '#f59e0b', '#dc2626'], borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }
      });
    }

    console.log('[charts] all 3 charts rendered successfully');
  } catch(e) {
    console.error('[charts] render error:', e);
  }
}

// --- Dashboard Calculator ---
var _calcCurrent = '0', _calcPrev = '', _calcOp = '', _calcReset = false;

function initCalc() {
  var container = document.getElementById('calc-keys');
  if (!container) return;
  // Wire toggle button via addEventListener (CSP-safe)
  var toggleBtn = document.getElementById('calc-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function() {
      var body = document.getElementById('calc-body');
      var icon = document.getElementById('calc-toggle-icon');
      if (body.style.display === 'none') {
        body.style.display = '';
        if (icon) icon.textContent = 'tap to collapse ▲';
      } else {
        body.style.display = 'none';
        if (icon) icon.textContent = 'tap to expand ▼';
      }
    });
  }
  var keys = [
    { label: 'C', cls: 'calc-red', action: 'clear' },
    { label: '⌫', cls: 'calc-gray', action: 'back' },
    { label: '%', cls: 'calc-gray', action: 'pct' },
    { label: '÷', cls: 'calc-gold', action: 'op', op: '/' },
    { label: '7', cls: '', action: 'num' },
    { label: '8', cls: '', action: 'num' },
    { label: '9', cls: '', action: 'num' },
    { label: '×', cls: 'calc-gold', action: 'op', op: '*' },
    { label: '4', cls: '', action: 'num' },
    { label: '5', cls: '', action: 'num' },
    { label: '6', cls: '', action: 'num' },
    { label: '−', cls: 'calc-gold', action: 'op', op: '-' },
    { label: '1', cls: '', action: 'num' },
    { label: '2', cls: '', action: 'num' },
    { label: '3', cls: '', action: 'num' },
    { label: '+', cls: 'calc-gold', action: 'op', op: '+' },
    { label: '0', cls: 'calc-wide', action: 'num' },
    { label: '.', cls: '', action: 'dot' },
    { label: '=', cls: 'calc-green', action: 'eq' },
  ];
  container.innerHTML = keys.map(function(k) {
    return '<button class="calc-btn ' + (k.cls || '') + '" data-action="' + k.action + '"' +
      (k.op ? ' data-op="' + k.op + '"' : '') +
      ' data-label="' + k.label + '">' + k.label + '</button>';
  }).join('');
  container.addEventListener('click', function(e) {
    var btn = e.target.closest('.calc-btn');
    if (!btn) return;
    calcPress(btn.dataset.action, btn.dataset.label, btn.dataset.op);
  });
}

function calcPress(action, label, op) {
  var display = document.getElementById('calc-display');
  var expr = document.getElementById('calc-expr');
  if (!display) return;

  if (action === 'clear') {
    _calcCurrent = '0'; _calcPrev = ''; _calcOp = ''; _calcReset = false;
    if (expr) expr.textContent = '';
  } else if (action === 'back') {
    if (_calcCurrent.length > 1) _calcCurrent = _calcCurrent.slice(0, -1);
    else _calcCurrent = '0';
  } else if (action === 'num') {
    if (_calcReset) { _calcCurrent = ''; _calcReset = false; }
    if (_calcCurrent === '0' && label !== '0') _calcCurrent = label;
    else if (_calcCurrent === '0' && label === '0') {}
    else _calcCurrent += label;
  } else if (action === 'dot') {
    if (_calcReset) { _calcCurrent = '0'; _calcReset = false; }
    if (_calcCurrent.indexOf('.') === -1) _calcCurrent += '.';
  } else if (action === 'pct') {
    _calcCurrent = String(parseFloat(_calcCurrent) / 100);
  } else if (action === 'op') {
    if (_calcPrev && _calcOp && !_calcReset) {
      _calcCurrent = String(calcEval(parseFloat(_calcPrev), parseFloat(_calcCurrent), _calcOp));
    }
    _calcPrev = _calcCurrent;
    _calcOp = op;
    _calcReset = true;
    var opSymbol = { '/': '÷', '*': '×', '-': '−', '+': '+' }[op] || op;
    if (expr) expr.textContent = _calcPrev + ' ' + opSymbol;
  } else if (action === 'eq') {
    if (_calcPrev && _calcOp) {
      var result = calcEval(parseFloat(_calcPrev), parseFloat(_calcCurrent), _calcOp);
      var opSymbol = { '/': '÷', '*': '×', '-': '−', '+': '+' }[_calcOp] || _calcOp;
      if (expr) expr.textContent = _calcPrev + ' ' + opSymbol + ' ' + _calcCurrent + ' =';
      _calcCurrent = String(result);
      _calcPrev = ''; _calcOp = ''; _calcReset = true;
    }
  }

  // Format display
  var num = parseFloat(_calcCurrent);
  if (!isNaN(num) && _calcCurrent.indexOf('.') === -1 && _calcCurrent.length < 16) {
    display.textContent = num.toLocaleString();
  } else {
    display.textContent = _calcCurrent;
  }
}

function calcEval(a, b, op) {
  if (op === '+') return +(a + b).toFixed(10);
  if (op === '-') return +(a - b).toFixed(10);
  if (op === '*') return +(a * b).toFixed(10);
  if (op === '/') return b !== 0 ? +(a / b).toFixed(10) : 0;
  return b;
}

// Weather alert banner on dashboard
async function loadDashWeatherBanner() {
  var el = document.getElementById('dash-weather-alert-banner');
  if (!el) return;
  try {
    var alerts = await fetch('/api/weather-alerts').then(function(r) { return r.json(); });
    var severe = (alerts || []).filter(function(a) {
      return ['Extreme','Severe'].indexOf(a.severity) !== -1;
    });
    if (!severe.length) { el.innerHTML = ''; return; }
    el.innerHTML = severe.map(function(a) {
      return '<div style="background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;padding:0.75rem 1rem;border-radius:10px;margin-bottom:0.5rem;display:flex;align-items:center;gap:0.5rem;animation:fadeIn 0.4s ease-out">' +
        '<span style="font-size:1.3rem">⚠️</span>' +
        '<div style="flex:1"><strong>ACTIVE WEATHER ALERT: ' + a.event + '</strong>' +
        '<div style="font-size:0.82rem;opacity:0.9">' + (a.headline || '') + '</div></div></div>';
    }).join('');
  } catch { el.innerHTML = ''; }
}
