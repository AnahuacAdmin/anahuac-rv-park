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

function _stripTime(dt) {
  if (!dt) return '';
  try {
    var iso = String(dt).replace(' ', 'T');
    if (!iso.endsWith('Z') && !iso.includes('+')) iso += 'Z';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

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

    <div id="dash-banner-wrapper" class="dash-fade-in" style="animation-delay:0.05s">
      <div class="page-header" id="dash-header-inner">
        <h2>${getTimeGreeting()}, ${API.user?.username || 'Admin'}!</h2>
        ${isAdmin() ? '<div class="btn-group"><button class="btn btn-outline" style="font-size:0.85rem" onclick="showShareApp()">📱 Share App</button><button class="btn btn-danger" style="font-size:0.85rem" onclick="showEmergencyBroadcast()" title="Send emergency SMS to ALL tenants immediately. Use only for real emergencies.">🚨 Emergency Alert</button></div>' : ''}
      </div>
    </div>

    <div id="dash-community-strip"></div>

    <div id="dash-weather-alert-banner"></div>

    <div id="dash-backup-reminder-banner"></div>

    <!-- Weekly Arrivals/Departures -->
    ${isAdmin() ? `
    <div class="card dash-fade-in" id="weekly-widget" style="animation-delay:0.08s;padding:0">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 1rem 0.5rem">
        <h3 style="margin:0;font-size:0.95rem;font-weight:700;color:#1c1917">📅 This Week at the Park</h3>
        <button id="weekly-toggle-btn" style="background:none;border:none;font-size:0.75rem;color:#78716c;cursor:pointer;font-weight:600" onclick="toggleWeeklyWidget()">▲ Hide</button>
      </div>
      <div id="weekly-calendar" style="padding:0 1rem 0.75rem">
        <div style="text-align:center;padding:1rem;color:#a8a29e;font-size:0.85rem">Loading...</div>
      </div>
    </div>` : ''}

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

    <!-- Google Reviews -->
    ${isAdmin() ? `
    <div class="card dash-fade-in" style="animation-delay:0.43s">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
        <h3 style="margin:0">⭐ Google Reviews</h3>
        <a href="https://search.google.com/local/writereview?placeid=ChIJgTxw3Pk-P4YRs2t_UMVRVa4" target="_blank" rel="noopener" class="btn btn-sm btn-outline" style="font-size:0.75rem">View on Google</a>
      </div>
      <div id="dash-reviews" style="font-size:0.85rem;color:var(--gray-500)">Loading review stats...</div>
    </div>` : ''}

    <!-- Quick Actions -->
    <div class="dash-actions dash-fade-in" style="animation-delay:0.45s">
      <button class="dash-action-btn" onclick="navigateTo('meters')"><span class="dash-action-icon">⚡</span>Meter Readings</button>
      <button class="dash-action-btn" onclick="navigateTo('electric')"><span class="dash-action-icon">📊</span>Electric Analytics</button>
      ${isAdmin() ? `<button class="dash-action-btn" onclick="navigateTo('billing')"><span class="dash-action-icon">🧾</span>Invoices${data.pendingInvoices ? `<span class="dash-action-badge">${data.pendingInvoices}</span>` : ''}</button>` : ''}
      ${isAdmin() ? `<button class="dash-action-btn" onclick="navigateTo('reports')"><span class="dash-action-icon">📊</span>Monthly Report</button>` : ''}
      ${isAdmin() ? `<button class="dash-action-btn" onclick="navigateTo('payments')"><span class="dash-action-icon">💰</span>Payments</button>` : ''}
      <button class="dash-action-btn" onclick="navigateTo('checkins')"><span class="dash-action-icon">🏕️</span>Check In</button>
      <button class="dash-action-btn" onclick="showApplicationPicker()"><span class="dash-action-icon">📋</span>Guest Application</button>
      <button class="dash-action-btn" onclick="navigateTo('reservations')"><span class="dash-action-icon">📅</span>Reservations${data.pendingReservations ? `<span class="dash-action-badge">${data.pendingReservations}</span>` : ''}</button>
      <button class="dash-action-btn" onclick="navigateTo('messages')"><span class="dash-action-icon">📱</span>Messaging</button>
      <a class="dash-action-btn dash-portal-btn" href="/portal.html" target="_blank" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#0d1a50;border:2px solid #d97706;text-decoration:none">
        <span class="dash-action-icon" style="font-size:2rem">🐊</span>
        <span style="font-weight:700;font-size:0.85rem">Guest Portal</span>
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
    <div class="card dash-fade-in" style="animation-delay:0.795s">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
        <h3 style="margin:0">💚 Guest Credits</h3>
        <span id="dash-credits-total" style="font-weight:700;color:#16a34a"></span>
      </div>
      <div id="dash-credits" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
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
    <div class="card dash-fade-in" style="animation-delay:0.855s">
      <h3>💧 Water Usage</h3>
      <div id="dash-water" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
    </div>

    <div class="card dash-fade-in" style="animation-delay:0.86s">
      <h3>🏥 Park Health Score</h3>
      <div id="dash-health-score" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
    </div>

    <div class="card dash-fade-in" style="animation-delay:0.87s">
      <h3>⚡ Electric Alerts</h3>
      <div id="dash-electric-alerts" style="font-size:0.85rem;color:var(--gray-500)">Loading...</div>
    </div>

    <div id="dash-inspections-widget" style="display:none"></div>

    <div id="dash-birthdays-widget" style="display:none"></div>

` : ''}

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
      <span id="dash-backup-reminder" style="color:var(--gray-500)"></span>
      <button class="btn btn-sm btn-outline" style="padding:0.2rem 0.6rem;font-size:0.72rem;border-radius:6px" onclick="downloadEmergencyBackup()">💾 Backup</button>
      <span style="color:var(--gray-400)">|</span>
      <span style="color:var(--gray-500)">Last sync: <span id="sync-status">—</span></span>
      <button class="btn btn-sm btn-outline" style="padding:0.2rem 0.6rem;font-size:0.72rem;border-radius:6px" onclick="if(typeof syncPendingRecords==='function')syncPendingRecords()">🔄 Sync Now</button>
      <span style="color:var(--gray-400)">|</span>
      <a href="/emergency-form.html" target="_blank" style="color:var(--brand-primary,#1a5c32);font-weight:600;text-decoration:none">🖨️ Emergency Forms</a>
    </div>

    ${isAdmin() ? `
    <!-- Weather Section -->
    <div class="card dash-fade-in" style="animation-delay:0.92s;padding:0;overflow:hidden;max-width:100%" id="dash-radar-section">
      <div id="dash-radar-alerts"></div>
      <div style="padding:0.85rem 1rem 0.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
        <div>
          <h3 style="margin:0;font-size:0.95rem;color:var(--gray-900)">🌩️ Live Weather — Anahuac, TX</h3>
          <div style="font-size:0.72rem;color:var(--gray-400);margin-top:0.15rem" id="dash-radar-clock">Radar updates every 10 min</div>
        </div>
        <button class="btn btn-sm btn-outline" onclick="toggleDashRadarFullscreen()" id="dash-radar-fs-btn" style="font-size:0.75rem">⛶ Full Screen</button>
      </div>

      <!-- Radar + Weather panel side by side -->
      <div style="display:flex;flex-wrap:wrap">
        <div style="flex:2;min-width:280px">
          <div id="dash-radar-map" style="height:400px;background:#e5e7eb;display:flex;align-items:center;justify-content:center;color:#78716c;font-size:0.88rem">
            Loading radar...
          </div>
        </div>
        <div id="dash-weather-panel" style="flex:1;min-width:220px;max-width:300px;padding:0.75rem;background:#f9fafb;border-left:1px solid #e5e7eb;font-size:0.82rem">
          <div style="color:var(--gray-400);font-size:0.72rem;text-align:center">Loading weather...</div>
        </div>
      </div>

      <!-- Controls -->
      <div id="dash-radar-controls" style="display:none;padding:0.5rem 1rem;background:#f9fafb;border-top:1px solid #e5e7eb">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem">
          <div style="display:flex;gap:0.35rem">
            <button id="dash-radar-play-btn" onclick="toggleDashRadarPlay()" style="background:var(--brand-primary,#1a5c32);color:#fff;border:none;border-radius:6px;padding:0.35rem 0.75rem;font-size:0.78rem;font-weight:600;cursor:pointer;min-width:60px">▶ Play</button>
            <button onclick="resetDashRadarView()" style="background:#fff;color:var(--gray-600);border:1px solid var(--gray-300);border-radius:6px;padding:0.35rem 0.6rem;font-size:0.75rem;cursor:pointer">📍 Reset</button>
          </div>
          <div id="dash-radar-timestamp" style="font-size:0.72rem;color:#78716c;text-align:right"></div>
        </div>
      </div>

      <!-- Radar Legend -->
      <div style="padding:0.4rem 1rem;background:#fff;border-top:1px solid #e5e7eb;display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;font-size:0.68rem;color:var(--gray-600)">
        <span style="font-weight:600">Radar:</span>
        <span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:10px;background:#00e400;border-radius:2px;display:inline-block"></span>Light</span>
        <span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:10px;background:#00c800;border-radius:2px;display:inline-block"></span>Moderate</span>
        <span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:10px;background:#ffff00;border-radius:2px;display:inline-block"></span>Heavy</span>
        <span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:10px;background:#ff8c00;border-radius:2px;display:inline-block"></span>Very Heavy</span>
        <span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:10px;background:#ff0000;border-radius:2px;display:inline-block"></span>Extreme</span>
        <span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:10px;background:#c800c8;border-radius:2px;display:inline-block"></span>Hail</span>
      </div>

      <!-- 7-Day Forecast -->
      <div id="dash-forecast" style="padding:0.6rem 1rem;border-top:1px solid #e5e7eb;overflow-x:auto">
        <div style="font-size:0.72rem;color:var(--gray-400);text-align:center">Loading forecast...</div>
      </div>

      <!-- Severe Weather Procedures -->
      <details style="border-top:1px solid #e5e7eb">
        <summary style="padding:0.65rem 1rem;cursor:pointer;font-size:0.82rem;font-weight:600;color:var(--brand-primary);user-select:none;list-style:none">
          ⚠️ Severe Weather Procedures <span style="float:right;font-size:0.7rem;color:var(--gray-400)">tap to expand</span>
        </summary>
        <div style="padding:0 1rem 1rem;font-size:0.85rem;line-height:1.6;color:var(--gray-700)">
          <p style="margin:0.5rem 0"><strong style="color:#dc2626">🌀 Hurricane Warning:</strong></p>
          <ol style="margin:0.25rem 0 0.75rem;padding-left:1.25rem">
            <li>Send SMS blast via 🚨 Emergency Alert button</li>
            <li>Post announcement on tenant portal</li>
            <li>Instruct tenants to disconnect utilities and secure RVs</li>
            <li>Follow Chambers County evacuation orders</li>
            <li>Document park condition with photos</li>
          </ol>
          <p style="margin:0.5rem 0"><strong>🚨 Emergency Contacts:</strong></p>
          <ul style="margin:0.25rem 0 0.5rem;padding-left:1.25rem">
            <li><strong>Chambers County Emergency:</strong> 911</li>
            <li><strong>Park Office:</strong> (409) 267-6603</li>
            <li><strong>Park Address:</strong> 1003 Davis Ave, Anahuac, TX 77514</li>
          </ul>
        </div>
      </details>
    </div>` : ''}
  `;

  waitForChartAndRender(data);
  loadDashWeatherBanner();
  if (isAdmin()) loadWeeklySchedule();
  if (isAdmin()) loadDashBackupReminder();
  loadDashBanner();

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
    loadDashCredits();
    loadDashDeposits();
    loadDashMaintenance();
    loadDashExpenses();
    loadDashHealthScore();
    loadDashElectricAlerts();
    loadDashWater();
    loadDashInspections();
    loadDashBirthdays();
    if (typeof checkBackupReminder === 'function') checkBackupReminder();
    initDashRadar();

    loadDashCommunity();
    loadDashReviews();
  }

  // Init calculator
  initCalc();
}

async function loadDashBackupReminder() {
  const banner = document.getElementById('dash-backup-reminder-banner');
  if (!banner) return;
  try {
    const info = await API.get('/admin/backup-info');
    const lastBackup = info?.lastBackupAt ? new Date(info.lastBackupAt) : null;
    const now = new Date();
    const daysSince = lastBackup ? Math.floor((now - lastBackup) / (1000 * 60 * 60 * 24)) : 999;
    const isFirstOfMonth = now.getDate() === 1;

    // Check dismiss (localStorage)
    const dismissUntil = localStorage.getItem('backup_dismiss_until');
    const isDismissed = dismissUntil && new Date(dismissUntil) > now;

    // Show if: 30+ days since last backup (or never backed up), and not dismissed — OR first of month always
    const shouldShow = (daysSince >= 30 && !isDismissed) || (isFirstOfMonth && daysSince >= 7);
    if (!shouldShow) return;

    const urgency = daysSince >= 60 ? 'border-left:4px solid #dc2626;background:#fef2f2' :
                    daysSince >= 30 ? 'border-left:4px solid #f59e0b;background:#fffbeb' :
                    'border-left:4px solid #0284c7;background:#eff6ff';
    const icon = daysSince >= 60 ? '🚨' : '⚠️';
    const msg = lastBackup
      ? `Your last backup was <strong>${daysSince} days ago</strong> (${lastBackup.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}). We recommend backing up at least once a month.`
      : `<strong>No backup has been created yet.</strong> We strongly recommend downloading a backup of your data.`;

    banner.innerHTML = `
      <div class="card dash-fade-in" style="${urgency};padding:0.85rem 1rem;margin-bottom:0.5rem;animation-delay:0.06s">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem">
          <div style="flex:1;min-width:200px">
            <strong style="font-size:0.9rem">${icon} Monthly Backup Reminder</strong>
            <p style="margin:0.25rem 0 0;font-size:0.82rem;color:#57534e">${msg}</p>
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <button class="btn btn-sm btn-primary" onclick="navigateTo('admin')" style="font-size:0.8rem">💾 Go to Backup</button>
            <button class="btn btn-sm btn-outline" onclick="dismissBackupReminder()" style="font-size:0.75rem;color:#78716c">Remind me later</button>
          </div>
        </div>
      </div>`;
  } catch {}
}

function dismissBackupReminder() {
  // Dismiss for 7 days
  const until = new Date();
  until.setDate(until.getDate() + 7);
  localStorage.setItem('backup_dismiss_until', until.toISOString());
  const banner = document.getElementById('dash-backup-reminder-banner');
  if (banner) banner.innerHTML = '';
}

async function loadDashReviews() {
  var el = document.getElementById('dash-reviews');
  if (!el) return;
  try {
    var data = await API.get('/reviews');
    var html = '<div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-bottom:0.5rem">';
    html += '<span style="font-size:0.9rem"><strong>' + data.thisMonth + '</strong> review requests sent this month</span>';
    html += '</div>';
    if (data.requests.length) {
      html += '<div style="max-height:180px;overflow-y:auto"><table class="data-table" style="font-size:0.8rem"><thead><tr><th>Date</th><th>Guest</th><th>Lot</th><th>Method</th></tr></thead><tbody>';
      data.requests.slice(0, 10).forEach(function(r) {
        html += '<tr><td>' + (r.sent_at || '').split('T')[0] + '</td><td>' + escapeHtml(r.tenant_name || '') + '</td><td>' + escapeHtml(r.lot_number || '') + '</td><td>' + escapeHtml(r.method || '') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<p style="color:var(--gray-400);font-size:0.82rem">No review requests sent yet. Requests are sent automatically at checkout.</p>';
    }
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<span style="color:var(--gray-400)">Could not load review data</span>';
  }
}

async function loadDashCredits() {
  var el = document.getElementById('dash-credits');
  var totalEl = document.getElementById('dash-credits-total');
  if (!el) return;
  try {
    var data = await API.get('/credits/summary');
    if (totalEl) totalEl.textContent = formatMoney(data.total) + ' total';
    if (!data.tenants || data.tenants.length === 0) {
      el.innerHTML = '<span style="color:var(--gray-400)">No tenants have credit balances.</span>';
      if (totalEl) totalEl.textContent = '$0.00';
      return;
    }
    el.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem">' +
      '<thead><tr style="border-bottom:1px solid var(--gray-200)"><th style="text-align:left;padding:0.3rem">Guest</th><th style="text-align:left;padding:0.3rem">Lot</th><th style="text-align:right;padding:0.3rem">Credit</th></tr></thead>' +
      '<tbody>' + data.tenants.map(function(t) {
        return '<tr style="border-bottom:1px solid var(--gray-100)">' +
          '<td style="padding:0.3rem"><a href="#" onclick="event.preventDefault();navigateTo(\'tenants\')" style="color:var(--brand-primary);font-weight:600">' + escapeHtml(t.first_name + ' ' + t.last_name) + '</a></td>' +
          '<td style="padding:0.3rem">' + escapeHtml(t.lot_id) + '</td>' +
          '<td style="padding:0.3rem;text-align:right;font-weight:700;color:#16a34a">' + formatMoney(t.credit_balance) + '</td></tr>';
      }).join('') + '</tbody></table>';
  } catch { el.innerHTML = '<span style="color:var(--gray-400)">Failed to load.</span>'; }
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

async function loadDashBanner() {
  var wrapper = document.getElementById('dash-banner-wrapper');
  if (!wrapper) return;
  try {
    var res = await fetch('/api/settings/branding/image/banner');
    if (!res.ok) return; // no banner configured — keep default header
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    wrapper.style.cssText =
      'position:relative;border-radius:var(--radius,10px);overflow:hidden;' +
      'margin-bottom:0.75rem;background:#000';
    wrapper.innerHTML =
      '<img src="' + url + '" style="width:100%;height:200px;object-fit:cover;display:block;opacity:0.7">' +
      '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.15) 0%,rgba(0,0,0,0.55) 100%);display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;flex-wrap:wrap;gap:0.5rem">' +
        '<h2 style="color:#fff;margin:0;font-size:1.5rem;text-shadow:0 2px 8px rgba(0,0,0,0.5)">' +
          getTimeGreeting() + ', ' + (API.user?.username || 'Admin') + '!' +
        '</h2>' +
        (isAdmin() ?
          '<button class="btn btn-danger" style="font-size:0.85rem" onclick="showEmergencyBroadcast()" title="Send emergency SMS to ALL tenants immediately.">🚨 Emergency Alert</button>'
          : '') +
      '</div>';
  } catch {}
}

// =====================================================================
// Dashboard Weather Radar (lazy loaded)
// =====================================================================
var _dashRadarMap = null, _dashRadarLayers = [], _dashRadarIdx = 0, _dashRadarPlaying = false, _dashRadarInterval = null, _dashRadarLoaded = false;

function _loadLeafletAssets() {
  if (!document.getElementById('leaflet-css-dash')) {
    var link = document.createElement('link');
    link.id = 'leaflet-css-dash'; link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  return new Promise(function(resolve) {
    if (window.L) return resolve();
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

async function initDashRadar() {
  if (_dashRadarLoaded) return;
  _dashRadarLoaded = true;

  await _loadLeafletAssets();
  var mapEl = document.getElementById('dash-radar-map');
  if (!mapEl || !window.L) { _dashRadarLoaded = false; return; }
  mapEl.innerHTML = '';
  mapEl.style.height = '400px'; // ensure fixed height before Leaflet init

  _dashRadarMap = L.map('dash-radar-map', { center: [29.7691, -94.6827], zoom: 7, maxZoom: 8, zoomControl: true, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 8 }).addTo(_dashRadarMap);
  L.marker([29.7691, -94.6827]).addTo(_dashRadarMap).bindPopup('<strong>Anahuac RV Park</strong><br>1003 Davis Ave');

  // Force Leaflet to recalculate container size
  setTimeout(function() { if (_dashRadarMap) _dashRadarMap.invalidateSize(); }, 200);

  try {
    var rv = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    var data = await rv.json();
    var frames = (data.radar && data.radar.past) ? data.radar.past : [];
    if (data.radar && data.radar.nowcast) frames = frames.concat(data.radar.nowcast);

    _dashRadarLayers = frames.map(function(f) {
      var layer = L.tileLayer('https://tilecache.rainviewer.com' + f.path + '/256/{z}/{x}/{y}/2/1_1.png', { opacity: 0, maxZoom: 8 });
      layer._rvTime = f.time;
      return layer;
    });

    if (_dashRadarLayers.length > 0) {
      _dashRadarIdx = _dashRadarLayers.length - 1;
      _dashRadarLayers[_dashRadarIdx].addTo(_dashRadarMap).setOpacity(0.65);
      _updateDashRadarTs();
      document.getElementById('dash-radar-controls').style.display = '';
      toggleDashRadarPlay();
    }
  } catch (e) { console.error('[dash-radar]', e); }

  // Load NWS alerts, weather panel, forecast, and clock
  loadDashNWSAlerts();
  loadDashWeatherPanel();
  loadDashForecast();
  startDashRadarClock();
  // Auto refresh every 10 minutes
  setInterval(function() { refreshDashRadar(); loadDashWeatherPanel(); }, 10 * 60 * 1000);
}

function _updateDashRadarTs() {
  var el = document.getElementById('dash-radar-timestamp');
  if (!el || !_dashRadarLayers[_dashRadarIdx]) return;
  var t = _dashRadarLayers[_dashRadarIdx]._rvTime;
  if (t) {
    var d = new Date(t * 1000);
    el.textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' — ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

function _showDashRadarFrame(idx) {
  _dashRadarLayers.forEach(function(layer, i) {
    if (i === idx) { if (!_dashRadarMap.hasLayer(layer)) layer.addTo(_dashRadarMap); layer.setOpacity(0.65); }
    else { layer.setOpacity(0); }
  });
  _dashRadarIdx = idx;
  _updateDashRadarTs();
}

function toggleDashRadarPlay() {
  var btn = document.getElementById('dash-radar-play-btn');
  if (_dashRadarPlaying) {
    clearInterval(_dashRadarInterval); _dashRadarPlaying = false;
    if (btn) btn.textContent = '▶ Play';
  } else {
    _dashRadarPlaying = true;
    if (btn) btn.textContent = '⏸ Pause';
    _dashRadarInterval = setInterval(function() {
      _showDashRadarFrame((_dashRadarIdx + 1) % _dashRadarLayers.length);
    }, 700);
  }
}

async function refreshDashRadar() {
  if (!_dashRadarMap) return;
  try {
    var rv = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    var data = await rv.json();
    var frames = (data.radar && data.radar.past) ? data.radar.past : [];
    if (data.radar && data.radar.nowcast) frames = frames.concat(data.radar.nowcast);
    _dashRadarLayers.forEach(function(l) { if (_dashRadarMap.hasLayer(l)) _dashRadarMap.removeLayer(l); });
    _dashRadarLayers = frames.map(function(f) {
      var layer = L.tileLayer('https://tilecache.rainviewer.com' + f.path + '/256/{z}/{x}/{y}/2/1_1.png', { opacity: 0, maxZoom: 8 });
      layer._rvTime = f.time; return layer;
    });
    if (_dashRadarLayers.length) { _dashRadarIdx = _dashRadarLayers.length - 1; _showDashRadarFrame(_dashRadarIdx); }
  } catch {}
}

async function loadDashNWSAlerts() {
  var el = document.getElementById('dash-radar-alerts');
  if (!el) return;
  try {
    var r = await fetch('https://api.weather.gov/alerts/active?zone=TXC071');
    var data = await r.json();
    var alerts = (data.features || []).filter(function(f) { return f.properties && f.properties.event; });
    if (!alerts.length) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = alerts.map(function(a) {
      var p = a.properties;
      var sev = p.severity || 'Unknown';
      var bg = sev === 'Extreme' ? '#7f1d1d' : sev === 'Severe' ? '#dc2626' : sev === 'Moderate' ? '#f59e0b' : '#1a5c32';
      return '<div style="background:' + bg + ';color:#fff;padding:0.6rem 1rem;font-size:0.85rem;font-weight:600">' +
        '⚠️ ' + (p.event || 'Weather Alert') +
        (p.headline ? '<div style="font-weight:400;font-size:0.78rem;margin-top:0.2rem;opacity:0.9">' + p.headline + '</div>' : '') + '</div>';
    }).join('');
  } catch { el.style.display = 'none'; }
}

function resetDashRadarView() {
  if (_dashRadarMap) _dashRadarMap.setView([29.7691, -94.6827], 7);
}

function toggleDashRadarFullscreen() {
  var section = document.getElementById('dash-radar-section');
  var mapEl = document.getElementById('dash-radar-map');
  var btn = document.getElementById('dash-radar-fs-btn');
  if (!section) return;

  if (!section._isFullscreen) {
    section._isFullscreen = true;
    section._origStyle = section.style.cssText;
    section.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#fff;margin:0;border-radius:0;overflow-y:auto';
    if (mapEl) mapEl.style.height = 'calc(100vh - 120px)';
    if (btn) btn.textContent = '✕ Exit Full Screen';
    if (_dashRadarMap) setTimeout(function() { _dashRadarMap.invalidateSize(); }, 100);
  } else {
    section._isFullscreen = false;
    section.style.cssText = section._origStyle || '';
    if (mapEl) mapEl.style.height = '400px';
    if (btn) btn.textContent = '⛶ Full Screen';
    if (_dashRadarMap) setTimeout(function() { _dashRadarMap.invalidateSize(); }, 100);
  }
}

// Weather panel — current conditions from Open-Meteo
async function loadDashWeatherPanel() {
  var el = document.getElementById('dash-weather-panel');
  if (!el) return;
  try {
    var r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=29.7691&longitude=-94.6827&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,surface_pressure,visibility,uv_index&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Chicago');
    var d = await r.json();
    var c = d.current;
    if (!c) { el.innerHTML = '<div style="color:var(--gray-400)">Weather unavailable</div>'; return; }

    var windDir = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    var dir = windDir[Math.round((c.wind_direction_10m || 0) / 22.5) % 16];
    var visMiles = ((c.visibility || 0) / 1609).toFixed(1);
    var pressureInHg = ((c.surface_pressure || 0) * 0.02953).toFixed(2);
    var uvLabel = c.uv_index <= 2 ? 'Low' : c.uv_index <= 5 ? 'Moderate' : c.uv_index <= 7 ? 'High' : 'Very High';
    var uvColor = c.uv_index <= 2 ? '#16a34a' : c.uv_index <= 5 ? '#f59e0b' : '#dc2626';

    el.innerHTML =
      '<div style="text-align:center;margin-bottom:0.6rem">' +
        '<div style="font-size:2.2rem;font-weight:800;color:var(--gray-900)">' + Math.round(c.temperature_2m) + '°F</div>' +
        '<div style="font-size:0.75rem;color:var(--gray-500)">Feels like ' + Math.round(c.apparent_temperature) + '°F</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem 0.75rem;font-size:0.78rem">' +
        _wxRow('💨 Wind', Math.round(c.wind_speed_10m) + ' mph ' + dir) +
        _wxRow('💧 Humidity', c.relative_humidity_2m + '%') +
        _wxRow('👁️ Visibility', visMiles + ' mi') +
        _wxRow('📊 Pressure', pressureInHg + ' inHg') +
        _wxRow('☀️ UV Index', '<span style="color:' + uvColor + ';font-weight:600">' + c.uv_index + ' (' + uvLabel + ')</span>') +
      '</div>';
  } catch { el.innerHTML = '<div style="color:var(--gray-400);font-size:0.78rem">Weather unavailable</div>'; }
}

function _wxRow(label, value) {
  return '<div style="color:var(--gray-500)">' + label + '</div><div style="color:var(--gray-800);font-weight:500;text-align:right">' + value + '</div>';
}

// 7-day forecast from Open-Meteo
async function loadDashForecast() {
  var el = document.getElementById('dash-forecast');
  if (!el) return;
  try {
    var r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=29.7691&longitude=-94.6827&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&temperature_unit=fahrenheit&timezone=America/Chicago&forecast_days=7');
    var d = await r.json();
    if (!d.daily) return;

    var wxEmoji = function(code) {
      if (code === 0) return '☀️';
      if (code <= 3) return '⛅';
      if (code <= 48) return '🌫️';
      if (code <= 55) return '🌦️';
      if (code <= 65) return '🌧️';
      if (code <= 75) return '❄️';
      if (code <= 82) return '🌧️';
      if (code >= 95) return '⛈️';
      return '☁️';
    };

    var days = d.daily.time.map(function(t, i) {
      var dt = new Date(t + 'T12:00:00');
      var dayName = dt.toLocaleDateString('en-US', { weekday: 'short' });
      var hi = Math.round(d.daily.temperature_2m_max[i]);
      var lo = Math.round(d.daily.temperature_2m_min[i]);
      var precip = d.daily.precipitation_probability_max[i] || 0;
      var emoji = wxEmoji(d.daily.weathercode[i]);
      return '<div style="text-align:center;min-width:70px;flex-shrink:0">' +
        '<div style="font-size:0.72rem;font-weight:600;color:var(--gray-600)">' + dayName + '</div>' +
        '<div style="font-size:1.3rem;margin:0.15rem 0">' + emoji + '</div>' +
        '<div style="font-size:0.78rem;font-weight:700;color:var(--gray-900)">' + hi + '°</div>' +
        '<div style="font-size:0.72rem;color:var(--gray-400)">' + lo + '°</div>' +
        (precip > 0 ? '<div style="font-size:0.65rem;color:#3b82f6;margin-top:0.1rem">💧' + precip + '%</div>' : '') +
      '</div>';
    });

    el.innerHTML = '<div style="display:flex;gap:0.5rem;justify-content:space-between;overflow-x:auto">' + days.join('') + '</div>';
  } catch { el.innerHTML = ''; }
}

function startDashRadarClock() {
  function update() {
    var el = document.getElementById('dash-radar-clock');
    if (!el) return;
    var now = new Date();
    el.textContent = 'Radar updates every 10 min · ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT';
  }
  update();
  setInterval(update, 60000);
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

    // Most-recent community activity strip (post or reply, whichever is newer)
    var strip = document.getElementById('dash-community-strip');
    if (strip) {
      try {
        var activity = await API.get('/community/latest-activity');
        if (!activity) {
          strip.style.display = 'none';
        } else {
          var label, detail;
          var aTime = _stripTime(activity.ts);
          if (activity.type === 'reply') {
            label = '<strong style="color:var(--gray-800);font-weight:600">' + escapeHtml(activity.author) + '</strong> replied to: ' +
              '<strong style="color:var(--gray-800);font-weight:600">' + escapeHtml(activity.post_title || '(untitled)') + '</strong>';
          } else {
            label = '<strong style="color:var(--gray-800);font-weight:600">' + escapeHtml(activity.author) + '</strong> posted: ' +
              '<strong style="color:var(--gray-800);font-weight:600">' + escapeHtml(activity.post_title || '(untitled)') + '</strong>';
          }
          strip.innerHTML =
            '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;' +
            'padding:0.35rem 0.75rem;margin-bottom:0.75rem;font-size:0.78rem;' +
            'color:var(--gray-600);display:flex;align-items:center;gap:0.5rem;' +
            'flex-wrap:wrap;line-height:1.3">' +
              '<span style="opacity:0.7">📋</span>' +
              '<span>' + label + '</span>' +
              (aTime ? '<span style="color:var(--gray-400);font-size:0.72rem">· ' + aTime + '</span>' : '') +
              '<a href="#" onclick="event.preventDefault();navigateTo(\'community\')" ' +
                'style="margin-left:auto;color:var(--brand-primary);font-weight:500;text-decoration:none">View all →</a>' +
            '</div>';
        }
      } catch { strip.style.display = 'none'; }
    }
  } catch {}
}

async function loadDashBirthdays() {
  var widget = document.getElementById('dash-birthdays-widget');
  if (!widget) return;
  try {
    var bdays = await API.get('/dashboard/upcoming-birthdays');
    if (!bdays || !bdays.length) return;
    widget.style.display = '';
    widget.className = 'card dash-fade-in';
    widget.style.animationDelay = '0.88s';
    widget.innerHTML = '<h3>🎂 Upcoming Birthdays</h3>' +
      '<div style="font-size:0.85rem">' +
        bdays.map(function(b) {
          var label = b.days_until === 0
            ? '<span style="color:#dc2626;font-weight:700">Today!</span>'
            : b.days_until === 1
              ? '<span style="color:#f59e0b;font-weight:600">Tomorrow</span>'
              : '<span style="color:var(--gray-500)">' + b.birthday_date + ' (' + b.days_until + 'd)</span>';
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;border-bottom:1px solid var(--gray-100)">' +
            '<div>' +
              '<strong>' + escapeHtml(b.first_name + ' ' + b.last_name) + '</strong>' +
              ' <span style="font-size:0.78rem;color:var(--gray-400)">Lot ' + (b.lot_id || '?') + '</span>' +
            '</div>' +
            '<div style="text-align:right">' + label + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
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

async function loadDashWater() {
  var el = document.getElementById('dash-water');
  if (!el) return;
  try {
    var data = await API.get('/water-meters/analytics');
    var modeLabel = data.evaluationMode ? '📋 Evaluation' : '💰 Billing';
    var highCount = (data.lotStats || []).filter(function(l) {
      return data.allowance && l.this_month > data.allowance;
    }).length;
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<span>This month: <strong>' + Number(data.totalGallons || 0).toLocaleString() + ' gal</strong></span>' +
        '<a href="#" onclick="event.preventDefault();navigateTo(\'water-meters\')" style="font-size:0.78rem;color:var(--brand-primary)">View →</a>' +
      '</div>' +
      '<div style="font-size:0.78rem;color:var(--gray-500);margin-top:0.25rem">' +
        (data.readingsCount || 0) + '/' + (data.totalLots || 0) + ' lots read · Mode: ' + modeLabel +
      '</div>' +
      (highCount > 0 ? '<div style="font-size:0.78rem;color:#dc2626;margin-top:0.15rem">⚠️ ' + highCount + ' lot' + (highCount > 1 ? 's' : '') + ' over allowance</div>' : '');
  } catch { el.innerHTML = '<span style="color:#a8a29e">No water data</span>'; }
}

async function loadDashExpenses() {
  var el = document.getElementById('dash-expenses');
  if (!el) return;
  try {
    var summary = await API.get('/expenses/summary');
    var topCat = (summary?.byCategory || [])[0];
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<span>This month: <strong>' + formatMoney(summary?.total || 0) + '</strong></span>' +
        '<a href="#" onclick="event.preventDefault();navigateTo(\'expenses\')" style="font-size:0.78rem;color:var(--brand-primary)">View →</a>' +
      '</div>' +
      (summary?.yearTotal ? '<div style="font-size:0.78rem;color:var(--gray-500);margin-top:0.25rem">Year total: ' + formatMoney(summary.yearTotal) + (topCat ? ' · Top: ' + escapeHtml(topCat.category) : '') + '</div>' : '') +
      (summary?.receiptCount ? '<div style="font-size:0.72rem;color:var(--gray-400);margin-top:0.15rem">🧾 ' + summary.receiptCount + ' receipts on file</div>' : '');
  } catch { el.innerHTML = ''; }
}

async function loadDashInspections() {
  var el = document.getElementById('dash-inspections-widget');
  if (!el) return;
  try {
    var inspections = await API.get('/inspections');
    var drafts = (inspections || []).filter(function(i) { return i.status === 'draft'; });
    if (!drafts.length) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<div class="card dash-fade-in" style="border-left:4px solid #f59e0b;animation-delay:0.88s">' +
      '<div style="display:flex;align-items:center;gap:0.5rem">' +
      '<span style="font-size:1.2rem">📸</span>' +
      '<div style="flex:1"><strong style="color:#d97706">' + drafts.length + ' lot inspection' + (drafts.length > 1 ? 's' : '') + ' pending</strong>' +
      '<div style="font-size:0.78rem;color:#78716c">Review and send to tenants</div></div>' +
      '<a href="#" onclick="event.preventDefault();navigateTo(\'inspections\')" class="btn btn-sm btn-warning" style="white-space:nowrap">Review →</a>' +
      '</div></div>';
  } catch { el.style.display = 'none'; }
}

var _emergencyTemplates = [
  { icon: '🌀', label: 'Hurricane Warning', msg: 'HURRICANE WARNING: Please secure your RV immediately and move inside. Contact management at 409-267-6603.', weather: true },
  { icon: '🌪️', label: 'Tornado Warning', msg: 'TORNADO WARNING: Seek shelter immediately. Stay away from windows. Contact 409-267-6603 after the all-clear.', weather: true },
  { icon: '🌊', label: 'Flash Flood Warning', msg: 'FLASH FLOOD WARNING: Move to higher ground immediately. Do not drive through standing water. Call 409-267-6603.', weather: true },
  { icon: '⛈️', label: 'Severe Thunderstorm Warning', msg: 'SEVERE THUNDERSTORM WARNING: Stay indoors. Secure outdoor items. Large hail and damaging winds possible.', weather: true },
  { icon: '❄️', label: 'Winter Storm Warning', msg: 'WINTER STORM WARNING: Prepare for freezing temperatures. Protect pipes. Contact management at 409-267-6603.', weather: true },
  { icon: '🔥', label: 'Fire Alert', msg: 'FIRE ALERT: Please evacuate immediately. Call 911. Meet at the front office.', weather: false },
  { icon: '💧', label: 'Water Shutoff', msg: 'WATER SHUTOFF: Water will be off today for maintenance. We apologize for the inconvenience.', weather: false },
  { icon: '⚡', label: 'Power Outage', msg: 'POWER OUTAGE: We are aware of the outage and working to restore power. Updates coming.', weather: false },
  { icon: '🌊', label: 'Flood Warning', msg: 'FLOOD WARNING: Please move vehicles to higher ground immediately. Contact 409-267-6603.', weather: true },
];

var _emergencyWarnings = {
  portal: { bg: '#eff6ff', border: '#93c5fd', color: '#1e40af', text: 'This will post to all tenant portal inboxes.' },
  sms:    { bg: '#fee2e2', border: '#fca5a5', color: '#991b1b', text: 'This will send SMS to all tenants. Cannot be undone.' },
  both:   { bg: '#fff7ed', border: '#fdba74', color: '#92400e', text: 'This will send SMS and post to all portals. Cannot be undone.' },
};

function _emergencyWarningHtml(mode) {
  var w = _emergencyWarnings[mode] || _emergencyWarnings.portal;
  return '<div id="emergency-warning-box" style="background:' + w.bg + ';border:1px solid ' + w.border + ';border-radius:8px;padding:0.5rem 0.75rem;margin-bottom:1rem;color:' + w.color + ';font-size:0.82rem;font-weight:600">' + w.text + '</div>';
}

var _emergencyBtnStyles = {
  portal: { bg: 'linear-gradient(135deg,#1a5c32,#2d8a52)', label: '📋 Send to all portals' },
  sms:    { bg: 'linear-gradient(135deg,#dc2626,#b91c1c)', label: '📱 Send SMS to all tenants' },
  both:   { bg: 'linear-gradient(135deg,#d97706,#b45309)', label: '📋📱 Send to all tenants' },
};

function _updateEmergencyBtn(btn, mode) {
  var s = _emergencyBtnStyles[mode] || _emergencyBtnStyles.portal;
  btn.textContent = s.label;
  btn.style.background = s.bg;
}

function _deliveryOptionHtml(value, emoji, label, desc, checked) {
  return '<label class="em-delivery-opt' + (checked ? ' em-selected' : '') + '" style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.85rem;border:1.5px solid ' + (checked ? '#1a5c32' : '#e0e0e0') + ';border-radius:8px;background:' + (checked ? '#f0fdf4' : '#fff') + ';cursor:pointer;transition:all 0.15s ease;font-weight:400">' +
    '<input type="radio" name="emergency-delivery" value="' + value + '"' + (checked ? ' checked' : '') + ' style="accent-color:#1a5c32;width:16px;height:16px;flex-shrink:0">' +
    '<span style="font-size:1.1rem;flex-shrink:0">' + emoji + '</span>' +
    '<span style="flex:1"><strong style="font-size:0.88rem;color:#1c1917">' + label + '</strong>' +
    '<span style="display:block;font-size:0.76rem;color:#78716c;margin-top:1px">' + desc + '</span></span></label>';
}

function showEmergencyBroadcast() {
  var templates = _emergencyTemplates;
  showModal('🚨 Emergency Alert',
    _emergencyWarningHtml('portal') +
    '<div style="margin-bottom:1rem">' +
      '<div style="font-size:0.72rem;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem">Delivery method</div>' +
      '<div style="display:flex;flex-direction:column;gap:0.35rem">' +
        _deliveryOptionHtml('portal', '📋', 'Portal only', 'Posts to tenant portal inboxes (no SMS)', true) +
        _deliveryOptionHtml('sms', '📱', 'SMS only', 'Texts all tenants with phone numbers', false) +
        _deliveryOptionHtml('both', '📋📱', 'Both', 'Portal message + SMS text', false) +
      '</div>' +
    '</div>' +
    '<div style="margin-bottom:1rem">' +
      '<div style="font-size:0.72rem;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.35rem">Template</div>' +
      '<select id="emergency-template" style="width:100%;padding:0.55rem 0.75rem;border:1.5px solid #d6d3d1;border-radius:8px;font-size:0.92rem;background:#fff">' +
        templates.map(function(t, i) { return '<option value="' + i + '">' + t.icon + ' ' + t.label + '</option>'; }).join('') +
        '<option value="custom">✏️ Custom Message</option>' +
      '</select>' +
    '</div>' +
    '<div id="emergency-nws-section" style="display:none;margin-bottom:1rem">' +
      '<div style="font-size:0.72rem;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.35rem">📰 NWS weather headline (auto-fetched)</div>' +
      '<input type="text" id="emergency-nws-headline" readonly style="width:100%;padding:0.5rem 0.75rem;border:1.5px solid #d6d3d1;border-radius:8px;font-size:0.85rem;background:#fafaf9" placeholder="Fetching NWS alerts...">' +
    '</div>' +
    '<div style="margin-bottom:1rem">' +
      '<div style="font-size:0.72rem;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.35rem">Message</div>' +
      '<textarea id="emergency-msg" rows="4" style="width:100%;padding:0.6rem 0.75rem;border:1.5px solid #d6d3d1;border-radius:8px;font-size:0.92rem;font-family:inherit;resize:vertical">' + escapeHtml(templates[0].msg) + '</textarea>' +
    '</div>' +
    '<button id="btn-send-emergency" style="width:100%;padding:0.85rem;border:none;border-radius:10px;font-size:1rem;font-weight:700;color:#fff;background:linear-gradient(135deg,#1a5c32,#2d8a52);cursor:pointer;transition:filter 0.15s">📋 Send to all portals</button>');

  setTimeout(function() {
    var sel = document.getElementById('emergency-template');
    var msg = document.getElementById('emergency-msg');
    var nwsSection = document.getElementById('emergency-nws-section');
    var nwsInput = document.getElementById('emergency-nws-headline');
    var btn = document.getElementById('btn-send-emergency');
    var warningBox = document.getElementById('emergency-warning-box');

    // Delivery radio card selection styling + warning/button update
    var allOpts = document.querySelectorAll('.em-delivery-opt');
    document.querySelectorAll('input[name="emergency-delivery"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        var mode = this.value;
        allOpts.forEach(function(opt) {
          var isSelected = opt.querySelector('input').value === mode;
          opt.style.borderColor = isSelected ? '#1a5c32' : '#e0e0e0';
          opt.style.background = isSelected ? '#f0fdf4' : '#fff';
        });
        if (warningBox && warningBox.parentNode) {
          var tmp = document.createElement('div');
          tmp.innerHTML = _emergencyWarningHtml(mode);
          warningBox.parentNode.replaceChild(tmp.firstChild, warningBox);
          warningBox = document.getElementById('emergency-warning-box');
        }
        _updateEmergencyBtn(btn, mode);
      });
    });

    // Template change
    if (sel) sel.addEventListener('change', function() {
      var idx = parseInt(this.value);
      if (!isNaN(idx) && templates[idx]) {
        msg.value = templates[idx].msg;
        if (templates[idx].weather && nwsSection) {
          nwsSection.style.display = '';
          _fetchNWSForEmergency(nwsInput);
        } else if (nwsSection) {
          nwsSection.style.display = 'none';
        }
      } else {
        msg.value = '';
        if (nwsSection) nwsSection.style.display = 'none';
      }
    });

    // Initial weather template — show NWS section
    if (templates[0].weather && nwsSection) {
      nwsSection.style.display = '';
      _fetchNWSForEmergency(nwsInput);
    }

    // Send button
    if (btn) btn.addEventListener('click', async function() {
      var delivery = document.querySelector('input[name="emergency-delivery"]:checked')?.value || 'portal';
      var confirmMsg = delivery === 'portal' ? 'Post this emergency alert to all tenant portal inboxes?' :
        delivery === 'sms' ? 'CONFIRM: Send emergency SMS to ALL tenants? This cannot be undone.' :
        'CONFIRM: Send emergency alert via SMS AND portal to ALL tenants? This cannot be undone.';
      if (!confirm(confirmMsg)) return;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.textContent = 'Sending...';

      var finalMsg = msg.value;
      if (nwsSection && nwsSection.style.display !== 'none' && nwsInput && nwsInput.value) {
        finalMsg += '\n\nLatest NWS Update: ' + nwsInput.value;
      }

      try {
        var r = await API.post('/messages/emergency-alert', {
          delivery_type: delivery,
          subject: 'Emergency Alert',
          message: finalMsg,
        });
        closeModal();
        var parts = [];
        if (r.messagesPosted) parts.push(r.messagesPosted + ' portal messages');
        if (r.smsSent) parts.push(r.smsSent + ' SMS sent');
        showStatusToast('🚨', 'Emergency alert: ' + parts.join(', '));
      } catch (err) {
        alert('Failed: ' + (err.message || 'unknown'));
        btn.disabled = false;
        btn.style.opacity = '';
        _updateEmergencyBtn(btn, delivery);
      }
    });
  }, 50);
}

async function _fetchNWSForEmergency(inputEl) {
  if (!inputEl) return;
  inputEl.value = '';
  inputEl.placeholder = 'Fetching NWS alerts...';
  try {
    var alerts = await fetch('/api/weather-alerts').then(function(r) { return r.json(); });
    if (alerts && alerts.length) {
      inputEl.value = alerts[0].headline || alerts[0].event || '';
      inputEl.readOnly = false;
    } else {
      inputEl.value = '';
      inputEl.placeholder = 'No active NWS alerts. Paste headline here (optional)';
      inputEl.readOnly = false;
    }
  } catch {
    inputEl.value = '';
    inputEl.placeholder = 'Paste news article URL or headline here (optional)';
    inputEl.readOnly = false;
  }
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
        (v.phone ? '<a href="tel:' + escapeHtml(v.phone) + '" class="btn btn-sm btn-success mobile-call-btn" style="padding:0.2rem 0.5rem;font-size:0.72rem" onclick="event.stopPropagation()">📞 Call</a>' : '') +
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

// --- Weekly Arrivals/Departures Widget ---
var _weeklyExpanded = null; // track which day index is expanded
var _weeklyCollapsed = false;

function toggleWeeklyWidget() {
  var cal = document.getElementById('weekly-calendar');
  var btn = document.getElementById('weekly-toggle-btn');
  if (!cal) return;
  _weeklyCollapsed = !_weeklyCollapsed;
  cal.style.display = _weeklyCollapsed ? 'none' : '';
  if (btn) btn.textContent = _weeklyCollapsed ? '▼ Show' : '▲ Hide';
}

var _dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var _dayNamesFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function _formatWeekDate(dateStr) {
  var d = new Date(dateStr + 'T12:00:00');
  return { dayName: _dayNames[d.getDay()], dayNum: d.getDate(), full: _dayNamesFull[d.getDay()],
    month: d.toLocaleString('default', { month: 'short' }), date: d };
}

function _isToday(dateStr) {
  return dateStr === new Date().toISOString().split('T')[0];
}

function _isTomorrow(dateStr) {
  var t = new Date(); t.setDate(t.getDate() + 1);
  return dateStr === t.toISOString().split('T')[0];
}

async function loadWeeklySchedule() {
  var container = document.getElementById('weekly-calendar');
  if (!container) return;
  try {
    var data = await API.get('/dashboard/weekly-schedule');
    if (!data || !data.days) { container.innerHTML = ''; return; }

    var isMobile = window.innerWidth < 601;
    if (isMobile) {
      _renderWeeklyMobile(container, data);
    } else {
      _renderWeeklyDesktop(container, data);
    }
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:0.75rem;color:#a8a29e;font-size:0.82rem">Could not load schedule</div>';
  }
}

function _renderWeeklyDesktop(container, data) {
  var days = data.days;
  var arrByDay = {};
  var depByDay = {};
  (data.arrivals || []).forEach(function(a) { (arrByDay[a.date] = arrByDay[a.date] || []).push(a); });
  (data.departures || []).forEach(function(d) { (depByDay[d.date] = depByDay[d.date] || []).push(d); });

  var totalEvents = (data.arrivals || []).length + (data.departures || []).length;
  if (!totalEvents) {
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:#16a34a;font-size:0.88rem">✅ No arrivals or departures this week</div>';
    return;
  }

  var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';
  days.forEach(function(dateStr, i) {
    var info = _formatWeekDate(dateStr);
    var today = _isToday(dateStr);
    var arr = arrByDay[dateStr] || [];
    var dep = depByDay[dateStr] || [];
    var hasEvents = arr.length || dep.length;

    var bg = today ? '#f0fdf4' : '#fff';
    var border = today ? '2px solid #1a5c32' : '1px solid #e7e5e4';
    var shadow = today ? 'box-shadow:0 2px 12px rgba(26,92,50,0.15);' : '';
    var cursor = hasEvents ? 'cursor:pointer;' : '';

    html += '<div class="weekly-day-col" data-day-idx="' + i + '" style="background:' + bg + ';border:' + border + ';border-radius:10px;padding:0.5rem;min-height:110px;text-align:center;transition:all 0.15s;' + shadow + cursor + '">';
    html += '<div style="font-size:0.7rem;font-weight:600;color:' + (today ? '#1a5c32' : '#78716c') + ';text-transform:uppercase;letter-spacing:0.04em">' + info.dayName + '</div>';
    html += '<div style="font-size:1.3rem;font-weight:800;color:' + (today ? '#1a5c32' : '#1c1917') + ';margin:0.15rem 0">' + info.dayNum + '</div>';
    if (today) html += '<div style="font-size:0.6rem;font-weight:700;color:#1a5c32;margin-bottom:0.3rem">TODAY</div>';

    if (arr.length) {
      html += '<div style="background:#dcfce7;color:#166534;font-size:0.68rem;font-weight:700;border-radius:6px;padding:2px 6px;margin:3px auto;display:inline-block">▲ ' + arr.length + ' arriving</div>';
    }
    if (dep.length) {
      html += '<div style="background:#fff7ed;color:#92400e;font-size:0.68rem;font-weight:700;border-radius:6px;padding:2px 6px;margin:3px auto;display:inline-block">▼ ' + dep.length + ' departing</div>';
    }
    if (!hasEvents) {
      html += '<div style="font-size:0.72rem;color:#d6d3d1;margin-top:0.5rem">—</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  // Detail expansion area
  html += '<div id="weekly-detail" style="margin-top:0.5rem"></div>';

  container.innerHTML = html;

  // Wire click handlers on day columns
  container.querySelectorAll('.weekly-day-col').forEach(function(col) {
    col.addEventListener('click', function() {
      var idx = parseInt(this.dataset.dayIdx);
      var dateStr = days[idx];
      var arr = arrByDay[dateStr] || [];
      var dep = depByDay[dateStr] || [];
      if (!arr.length && !dep.length) return;
      _toggleWeeklyDetail(idx, dateStr, arr, dep);
    });
    // Hover effect
    col.addEventListener('mouseenter', function() { if (!_isToday(days[parseInt(this.dataset.dayIdx)])) this.style.background = '#fafaf9'; });
    col.addEventListener('mouseleave', function() { if (!_isToday(days[parseInt(this.dataset.dayIdx)])) this.style.background = '#fff'; });
  });
}

function _toggleWeeklyDetail(idx, dateStr, arrivals, departures) {
  var detail = document.getElementById('weekly-detail');
  if (!detail) return;
  if (_weeklyExpanded === idx) { detail.innerHTML = ''; _weeklyExpanded = null; return; }
  _weeklyExpanded = idx;

  var info = _formatWeekDate(dateStr);
  var html = '<div style="background:#fafaf9;border-radius:8px;padding:0.6rem 0.75rem;animation:fadeIn 0.2s ease-out">';
  html += '<div style="font-size:0.78rem;font-weight:700;color:#44403c;margin-bottom:0.4rem">' + info.full + ', ' + info.month + ' ' + info.dayNum + '</div>';

  if (arrivals.length) {
    arrivals.forEach(function(a) {
      html += '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.5rem;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:6px;margin-bottom:4px">';
      html += '<span style="font-size:0.8rem">▲</span>';
      html += '<div style="flex:1"><strong style="font-size:0.82rem">' + escapeHtml(a.name || '') + '</strong>';
      html += ' <span style="font-size:0.75rem;color:#78716c">Lot ' + (a.lot_id || '?') + '</span></div>';
      if (a.phone) html += '<a href="tel:' + escapeHtml(a.phone) + '" class="mobile-call-btn" style="font-size:0.72rem;background:#1a5c32;color:#fff;padding:2px 8px;border-radius:6px;text-decoration:none;font-weight:600;white-space:nowrap">📞 Call</a>';
      html += '</div>';
    });
  }
  if (departures.length) {
    departures.forEach(function(d) {
      html += '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.5rem;background:#fff7ed;border-left:3px solid #f59e0b;border-radius:6px;margin-bottom:4px">';
      html += '<span style="font-size:0.8rem">▼</span>';
      html += '<div style="flex:1"><strong style="font-size:0.82rem">' + escapeHtml(d.name || '') + '</strong>';
      html += ' <span style="font-size:0.75rem;color:#78716c">Lot ' + (d.lot_id || '?') + '</span></div>';
      if (d.phone) html += '<a href="tel:' + escapeHtml(d.phone) + '" class="mobile-call-btn" style="font-size:0.72rem;background:#d97706;color:#fff;padding:2px 8px;border-radius:6px;text-decoration:none;font-weight:600;white-space:nowrap">📞 Call</a>';
      html += '</div>';
    });
  }
  html += '</div>';
  detail.innerHTML = html;
}

function _renderWeeklyMobile(container, data) {
  var days = data.days;
  var arrByDay = {};
  var depByDay = {};
  (data.arrivals || []).forEach(function(a) { (arrByDay[a.date] = arrByDay[a.date] || []).push(a); });
  (data.departures || []).forEach(function(d) { (depByDay[d.date] = depByDay[d.date] || []).push(d); });

  var totalEvents = (data.arrivals || []).length + (data.departures || []).length;
  if (!totalEvents) {
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:#16a34a;font-size:0.88rem">✅ No arrivals or departures this week</div>';
    return;
  }

  var html = '';
  days.forEach(function(dateStr) {
    var arr = arrByDay[dateStr] || [];
    var dep = depByDay[dateStr] || [];
    if (!arr.length && !dep.length) return;

    var today = _isToday(dateStr);
    var tomorrow = _isTomorrow(dateStr);
    var info = _formatWeekDate(dateStr);
    var dayLabel = today ? 'Today' : tomorrow ? 'Tomorrow' : info.full + ' ' + info.month + ' ' + info.dayNum;

    html += '<div style="margin-bottom:0.6rem">';
    html += '<div style="font-size:0.75rem;font-weight:700;color:' + (today ? '#1a5c32' : '#44403c') + ';margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.03em">' + dayLabel + '</div>';

    arr.forEach(function(a) {
      html += '<div style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.6rem;background:#fff;border-left:3px solid #16a34a;border-radius:8px;margin-bottom:4px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">';
      html += '<div style="flex:1"><strong style="font-size:0.88rem;color:#1c1917">' + escapeHtml(a.name || '') + '</strong>';
      html += '<div style="font-size:0.75rem;color:#78716c">▲ Arriving · Lot ' + (a.lot_id || '?') + (a.phone ? ' · ' + a.phone : '') + '</div></div>';
      if (a.phone) html += '<a href="tel:' + escapeHtml(a.phone) + '" style="font-size:0.75rem;background:#1a5c32;color:#fff;padding:4px 10px;border-radius:8px;text-decoration:none;font-weight:700">📞</a>';
      html += '</div>';
    });

    dep.forEach(function(d) {
      html += '<div style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.6rem;background:#fff;border-left:3px solid #f59e0b;border-radius:8px;margin-bottom:4px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">';
      html += '<div style="flex:1"><strong style="font-size:0.88rem;color:#1c1917">' + escapeHtml(d.name || '') + '</strong>';
      html += '<div style="font-size:0.75rem;color:#78716c">▼ Departing · Lot ' + (d.lot_id || '?') + (d.phone ? ' · ' + d.phone : '') + '</div></div>';
      if (d.phone) html += '<a href="tel:' + escapeHtml(d.phone) + '" style="font-size:0.75rem;background:#d97706;color:#fff;padding:4px 10px;border-radius:8px;text-decoration:none;font-weight:700">📞</a>';
      html += '</div>';
    });

    html += '</div>';
  });

  container.innerHTML = html;
}
