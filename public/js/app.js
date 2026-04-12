/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
let currentPage = 'dashboard';

// --- Fun UI Celebrations & Status Toasts ---
function showCelebration(emoji, text, duration = 3000) {
  const el = document.createElement('div');
  el.className = 'celebration-overlay';
  el.innerHTML = `<div class="celebration-content"><div class="celebration-emoji">${emoji}</div><div class="celebration-text">${escapeHtml(text)}</div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, duration);
}

// --- Gator Check-In Celebration ---
function celebrateTenantCheckIn(firstName, lotId) {
  const overlay = document.createElement('div');
  overlay.className = 'gator-celebration';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:4000;pointer-events:none;overflow:hidden';

  // Confetti (35 pieces)
  let confettiHtml = '';
  const colors = ['#f59e0b','#1a5c32','#ffffff','#2d8a52','#d97706','#dcfce7'];
  for (let i = 0; i < 35; i++) {
    const c = colors[i % colors.length];
    const left = Math.random() * 100;
    const delay = Math.random() * 1.2;
    const dur = 2.5 + Math.random() * 1.5;
    const rot = Math.random() * 720 - 360;
    const size = 6 + Math.random() * 6;
    const shape = Math.random() > 0.5 ? '50%' : '2px';
    confettiHtml += `<div style="position:absolute;top:-20px;left:${left}%;width:${size}px;height:${size * 1.4}px;background:${c};border-radius:${shape};opacity:0.9;animation:gatorConfettiFall ${dur}s ease-in ${delay}s forwards;transform:rotate(${rot}deg)"></div>`;
  }

  // Fireworks (7 bursts)
  let fireworkHtml = '';
  const fwColors = ['#f59e0b','#1a5c32','#dc2626','#ffffff','#f59e0b','#2d8a52','#fbbf24'];
  const fwPositions = [[20,25],[75,20],[50,30],[30,45],[70,50],[15,60],[85,35]];
  for (let i = 0; i < 7; i++) {
    const [x, y] = fwPositions[i];
    const c = fwColors[i];
    const delay = i * 0.12;
    // Each firework = center dot + 8 particles shooting outward
    let particles = '';
    for (let p = 0; p < 8; p++) {
      const angle = p * 45;
      const dist = 25 + Math.random() * 20;
      const px = Math.cos(angle * Math.PI / 180) * dist;
      const py = Math.sin(angle * Math.PI / 180) * dist;
      particles += `<div style="position:absolute;width:5px;height:5px;background:${c};border-radius:50%;top:50%;left:50%;box-shadow:0 0 6px ${c};animation:gatorSparkle 0.8s ease-out ${delay + 0.1}s both;--sx:${px}px;--sy:${py}px"></div>`;
    }
    fireworkHtml += `<div style="position:absolute;top:${y}%;left:${x}%;width:0;height:0">
      <div style="position:absolute;width:8px;height:8px;background:${c};border-radius:50%;top:-4px;left:-4px;box-shadow:0 0 12px ${c},0 0 24px ${c};animation:gatorBurst 0.6s ease-out ${delay}s both"></div>
      ${particles}
    </div>`;
  }

  // Gator running across bottom
  const gatorHtml = `<div style="position:absolute;bottom:10%;left:-80px;font-size:4.5rem;animation:gatorRun 2.5s ease-in-out 0.3s forwards;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.3))">
    <span style="display:inline-block;animation:gatorBounce 0.3s ease-in-out infinite alternate">🐊</span>
    <span style="position:absolute;right:-15px;bottom:5px;font-size:1.5rem;opacity:0.5;animation:gatorDust 0.4s ease-out infinite">💨</span>
  </div>`;

  // Center message
  const msgHtml = `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;animation:gatorMsgIn 0.6s ease-out 0.2s both">
    <div style="font-size:2.5rem;margin-bottom:0.5rem;animation:gatorMsgBounce 0.5s ease-out 0.4s both">🎉 Welcome! 🎉</div>
    <div style="font-size:1.3rem;font-weight:800;color:#f59e0b;text-shadow:0 2px 8px rgba(0,0,0,0.5);line-height:1.4">${escapeHtml(firstName)} is checked in<br>to Lot ${escapeHtml(lotId)}!</div>
  </div>`;

  overlay.innerHTML = confettiHtml + fireworkHtml + gatorHtml + msgHtml;
  document.body.appendChild(overlay);

  // Fade out after 3.5s
  setTimeout(() => {
    overlay.style.transition = 'opacity 0.5s ease';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 600);
  }, 3500);
}

let _toastTimer = null;
let _toastSafetyTimer = null;

function showStatusToast(emoji, text, autoDismissMs = 4000) {
  let el = document.getElementById('status-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'status-toast';
    el.className = 'status-toast';
    document.body.appendChild(el);
  }
  clearTimeout(_toastTimer);
  clearTimeout(_toastSafetyTimer);
  // Reset state completely
  el.style.transition = 'none';
  el.classList.remove('toast-fade-out');
  el.classList.add('visible');
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  // Force reflow then restore transition
  void el.offsetHeight;
  el.style.transition = '';
  el.innerHTML = `<span class="status-toast-content">${emoji} ${escapeHtml(text)}</span><button class="status-toast-close" onclick="dismissToast()" aria-label="Close">&times;</button>`;
  // Auto-dismiss
  if (autoDismissMs >= 0) {
    _toastTimer = setTimeout(function() { dismissToast(); }, autoDismissMs);
  }
  // SAFETY NET: no toast survives longer than 8 seconds, period
  _toastSafetyTimer = setTimeout(function() { dismissToast(); }, 8000);
  return {
    update: function(newEmoji, newText, resetTimer) {
      if (resetTimer === undefined) resetTimer = true;
      var content = el.querySelector('.status-toast-content');
      if (content) content.innerHTML = `${newEmoji} ${escapeHtml(newText)}`;
      if (resetTimer) {
        clearTimeout(_toastTimer);
        clearTimeout(_toastSafetyTimer);
        _toastTimer = setTimeout(function() { dismissToast(); }, autoDismissMs >= 0 ? autoDismissMs : 4000);
        _toastSafetyTimer = setTimeout(function() { dismissToast(); }, 8000);
      }
    },
    hide: function(delay) {
      if (delay === undefined) delay = 0;
      clearTimeout(_toastTimer);
      clearTimeout(_toastSafetyTimer);
      if (delay > 0) { _toastTimer = setTimeout(function() { dismissToast(); }, delay); } else { dismissToast(); }
    },
  };
}

function dismissToast() {
  clearTimeout(_toastTimer);
  clearTimeout(_toastSafetyTimer);
  _toastTimer = null;
  _toastSafetyTimer = null;
  var el = document.getElementById('status-toast');
  if (!el) return;
  // Force hide immediately via inline styles — no CSS race conditions
  el.style.opacity = '0';
  el.style.transform = 'translateX(-50%) translateY(-120%)';
  el.style.pointerEvents = 'none';
  setTimeout(function() {
    el.classList.remove('visible', 'toast-fade-out');
    el.style.opacity = '';
    el.style.transform = '';
    el.style.pointerEvents = '';
  }, 400);
}

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning ☀️';
  if (h < 17) return 'Good afternoon 🌤️';
  return 'Good evening 🌙';
}

const DAILY_TIPS = [
  '💡 Use Mobile Entry mode on the Meter Readings page to speed up monthly readings.',
  '💡 Click any lot on the Site Map to see tenant details and billing history.',
  '💡 Set recurring fees on a tenant to auto-apply them on every invoice.',
  '💡 Use the Tax Reports button on the Reports page for a year-end financial summary.',
  '💡 Back up your database regularly from the Admin page.',
  '💡 The Check Late Fees button auto-applies $25 fees to invoices 3+ days old.',
  '💡 Export invoices to Excel for easy spreadsheet analysis.',
  '💡 Send payment reminders via SMS to all unpaid tenants with one click.',
  '💡 Use the QR code on invoices so tenants can pay online instantly.',
  '💡 The Recurring Fees Summary on the Tenants page shows all auto-charges at a glance.',
  '🐊 Did you know? Anahuac is the Alligator Capital of Texas!',
  '🎣 Great fishing at Lake Anahuac — bass, catfish and more!',
  '🦆 Please remind tenants to be kind to our resident ducks!',
  '🐊 Keep an eye out for alligators near the water!',
  '🌊 Trinity Bay is just minutes away from the park!',
  '🦅 Anahuac National Wildlife Refuge is nearby — great bird watching!',
  '🎣 Early morning is the best time to fish at the lake!',
];
function getDailyTip() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return DAILY_TIPS[dayOfYear % DAILY_TIPS.length];
}

// --- Universal Search ---
let _searchTimer = null;
let _searchActiveIdx = -1;

function onSearchInput(val) {
  clearTimeout(_searchTimer);
  const resultsEl = document.getElementById('search-results');
  if (val.length < 2) { resultsEl.classList.remove('open'); resultsEl.innerHTML = ''; _searchActiveIdx = -1; return; }
  _searchTimer = setTimeout(() => doGlobalSearch(val), 300);
}

async function doGlobalSearch(q) {
  const resultsEl = document.getElementById('search-results');
  try {
    const r = await API.get('/search?q=' + encodeURIComponent(q));
    let html = '';
    const groups = [
      { key: 'tenants', icon: '👤', label: 'Tenants', items: (r.tenants || []).map(t => ({ title: `${t.first_name} ${t.last_name}`, sub: `Lot ${t.lot_id}${t.phone ? ' · ' + t.phone : ''}`, action: `navigateTo('tenants')` })) },
      { key: 'checkins', icon: '🏕️', label: 'Check-ins', items: (r.checkins || []).map(c => ({ title: `${c.first_name} ${c.last_name}`, sub: `Lot ${c.lot_id} · ${c.status} · ${c.check_in_date || ''}`, action: `navigateTo('checkins')` })) },
      { key: 'reservations', icon: '📅', label: 'Reservations', items: (r.reservations || []).map(rv => ({ title: rv.guest_name, sub: `${rv.confirmation_number} · Lot ${rv.lot_id || '?'} · ${rv.status}`, action: `navigateTo('reservations')` })) },
      { key: 'invoices', icon: '🧾', label: 'Invoices', items: (r.invoices || []).map(i => ({ title: `${i.invoice_number} — ${i.first_name} ${i.last_name}`, sub: `Lot ${i.lot_id} · $${Number(i.total_amount).toFixed(2)} · ${i.status}`, action: `navigateTo('billing')` })) },
    ];
    for (const g of groups) {
      if (!g.items.length) continue;
      html += `<div class="search-group-label">${g.icon} ${g.label}</div>`;
      html += g.items.map(it => `<div class="search-result" onclick="${it.action}; closeSearch()"><div><div class="sr-title">${escapeHtml(it.title)}</div><div class="sr-sub">${escapeHtml(it.sub)}</div></div></div>`).join('');
    }
    if (!html) html = '<div class="search-no-results">No results found</div>';
    resultsEl.innerHTML = html;
    resultsEl.classList.add('open');
    _searchActiveIdx = -1;
  } catch { resultsEl.innerHTML = '<div class="search-no-results">Search failed</div>'; resultsEl.classList.add('open'); }
}

function searchKeydown(e) {
  const resultsEl = document.getElementById('search-results');
  const items = resultsEl.querySelectorAll('.search-result');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); _searchActiveIdx = Math.min(_searchActiveIdx + 1, items.length - 1); updateSearchActive(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _searchActiveIdx = Math.max(_searchActiveIdx - 1, 0); updateSearchActive(items); }
  else if (e.key === 'Enter' && _searchActiveIdx >= 0) { e.preventDefault(); items[_searchActiveIdx]?.click(); }
  else if (e.key === 'Escape') { closeSearch(); }
}

function updateSearchActive(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === _searchActiveIdx));
  if (_searchActiveIdx >= 0) items[_searchActiveIdx]?.scrollIntoView({ block: 'nearest' });
}

function closeSearch() {
  const resultsEl = document.getElementById('search-results');
  const input = document.getElementById('global-search');
  if (resultsEl) { resultsEl.classList.remove('open'); resultsEl.innerHTML = ''; }
  if (input) input.value = '';
  _searchActiveIdx = -1;
}

// Close search when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.sidebar-search')) closeSearch();
});

// --- PWA: Service Worker Registration & Install Prompt ---
let _deferredInstallPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('[pwa] service worker registered, scope:', reg.scope))
      .catch((err) => console.warn('[pwa] service worker registration failed:', err));
  });
}

// Capture the beforeinstallprompt event so we can show our own Install button.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  showInstallButton();
});

window.addEventListener('appinstalled', () => {
  _deferredInstallPrompt = null;
  hideInstallButton();
  console.log('[pwa] app installed');
});

function showInstallButton() {
  let btn = document.getElementById('pwa-install-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'pwa-install-btn';
    btn.className = 'pwa-install-btn';
    btn.innerHTML = '&#128242; Install App';
    btn.addEventListener('click', installPwa);
    document.body.appendChild(btn);
  }
  btn.style.display = '';
}

function hideInstallButton() {
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'none';
}

async function installPwa() {
  if (!_deferredInstallPrompt) return;
  _deferredInstallPrompt.prompt();
  const result = await _deferredInstallPrompt.userChoice;
  if (result.outcome === 'accepted') hideInstallButton();
  _deferredInstallPrompt = null;
}

// Format helpers
function formatMoney(n) { return '$' + (Number(n) || 0).toFixed(2); }
function formatDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString(); }

// Help/instructions panels for each module
const HELP_CONTENT = {
  dashboard: `<p><strong>Overview of park status.</strong> Check daily for outstanding balances, occupancy, and recent activity. Use the quick-action buttons to jump to any module. Revenue and occupancy charts update automatically.</p>
  <p><strong>Staff view:</strong> Staff members see occupancy and tenant info but not financial data (billing, payments, reports).</p>`,
  checkins: `<p><strong>Checking in a new tenant:</strong></p><ol>
    <li>Click <em>Check-In</em>.</li>
    <li>Enter tenant name, phone, and email.</li>
    <li>Select an available lot from the dropdown.</li>
    <li>Choose rate type (<strong>Monthly</strong>, <strong>Weekly</strong>, or <strong>Daily</strong>) and set the rate amount.</li>
    <li>Enter RV details — make, model, year, length, and license plate.</li>
    <li>Enter ID/driver's license number (for records) and emergency contact.</li>
    <li>Set the check-in date. For monthly tenants moving in mid-month, the system automatically calculates and shows the <strong>prorated first-month amount</strong>.</li>
    <li>Enter deposit amount if applicable.</li>
    <li>Click <em>Check In</em>. The system creates the tenant, marks the lot occupied, and generates a prorated invoice if applicable.</li>
    <li>After check-in you can <strong>Send a Welcome Text</strong> (via SMS) or <strong>Print a Welcome Card</strong> with WiFi password, park rules, and a QR code for online payment.</li>
  </ol>
  <p><strong>Checking out a tenant:</strong></p><ol>
    <li>Click <em>Check-Out</em>.</li>
    <li>Select the tenant from the dropdown.</li>
    <li>Enter the check-out date and any notes.</li>
    <li>Click <em>Check Out</em>. The lot is automatically marked vacant.</li>
  </ol>`,
  meters: `<p><strong>Two ways to enter readings:</strong></p>
  <p><strong>Table mode</strong> — for desktop:</p><ol>
    <li>Click any <strong>Current Reading</strong> or <strong>Date</strong> cell to edit it inline.</li>
    <li>kWh and charge recalculate automatically.</li>
    <li>Use <em>+ Quick Add</em> to select a lot and enter a new reading.</li>
    <li>Use <em>+ New Reading</em> for full control over previous/current values.</li>
    <li>Click the camera icon on any reading to view its attached photo.</li>
  </ol>
  <p><strong>Mobile Entry</strong> — for walking the park:</p><ol>
    <li>Click <em>Mobile Entry</em> to enter one-lot-at-a-time mode.</li>
    <li>Each card shows lot, tenant, and previous reading.</li>
    <li>Optionally <strong>take a photo</strong> of the meter using your phone camera.</li>
    <li>Enter the current reading — kWh and charge calculate instantly.</li>
    <li>Click <em>Save Reading</em> and it auto-advances to the next lot.</li>
    <li>Progress bar tracks how many lots are done.</li>
  </ol>`,
  billing: `<p><strong>Invoice workflow:</strong></p><ol>
    <li>After all meter readings are entered, click <em>Generate Monthly Invoices</em>. Choose month/year and click Generate.</li>
    <li>Invoices are <strong>color-coded by rate type</strong> (green = monthly, purple = weekly, amber = daily, gray = electric only). Look for the colored left border on each row.</li>
    <li>Click directly on <strong>Mailbox Fee, Misc Fee, Late Fee, Refund, or Notes</strong> cells to edit them inline — no need to open a form.</li>
    <li><em>Check Late Fees</em> auto-applies $25 to invoices 3+ days overdue.</li>
    <li>Use <em>View</em> to see a formatted invoice, <em>PDF</em> to download, <em>Email</em> to send with PDF attachment, or <em>SMS</em> to text a summary.</li>
    <li><em>Pay Now</em> opens Stripe online payment (3% convenience fee).</li>
    <li>Deleted invoices can be shown/restored using the <em>Show Deleted</em> checkbox.</li>
  </ol>
  <p>Prorated invoices show a <span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:10px;font-size:0.75rem">PRORATED</span> badge.</p>
  <p><strong>Tax Reports</strong> and <strong>Export to Excel</strong> are on the <em>Reports</em> page.</p>`,
  payments: `<ol>
    <li>When a tenant pays, click <em>Log Payment</em> on their row.</li>
    <li>Enter amount, payment method (Cash, Check, Money Order, or Credit/Debit Card — 3% convenience fee applies to card), and date.</li>
    <li>An <strong>SMS receipt</strong> is automatically sent to the tenant if they have a phone number on file.</li>
    <li>System updates invoice balance automatically. Overpayments are stored as <strong>tenant credit</strong>.</li>
    <li>Filter by <em>Unpaid</em> to see who still owes.</li>
    <li>Tenants can also pay online via the <strong>Tenant Portal</strong> or from the payment link in their invoice email.</li>
  </ol>`,
  messages: `<p><strong>Messaging options:</strong></p>
  <ul>
    <li><strong>Send Message</strong> — send to one tenant (record only, or via SMS).</li>
    <li><strong>Broadcast to All</strong> — message all tenants at once.</li>
    <li><strong>Send Notification</strong> — advanced: choose a template (Late Payment, Weather Emergency, Power Outage, General, Custom), pick recipients (all, unpaid only, or specific lot), and deliver via SMS, Email, or both.</li>
    <li><strong>Share Tenant Portal</strong> — text the portal login link to a tenant or all tenants so they can view invoices and pay online.</li>
  </ul>`,
  waitlist: `<ol>
    <li>Click <em>+ Add to Waitlist</em> to add a prospective tenant.</li>
    <li>Fill in contact info, RV length, and preferred lot.</li>
    <li>Track status: <strong>Waiting</strong> → <strong>Contacted</strong> → <strong>Placed</strong>.</li>
    <li>When a lot opens, edit the entry to update status, then go to <em>Check-In/Out</em> to move them in.</li>
  </ol>`,
  sitemap: `<p>Click any lot to view full tenant details, billing, payment history, meter readings, and notices.</p>
  <ul>
    <li><strong>Green border</strong> = Occupied</li>
    <li><strong>Green fill</strong> = Vacant (available)</li>
    <li><strong>Gray</strong> = Owner Reserved</li>
    <li><strong>Red border + glow</strong> = Unpaid / Overdue balance</li>
    <li><strong>Yellow border</strong> = Partial payment</li>
  </ul>
  <p>Admin view shows balance amounts and payment flags on each lot.</p>`,
  tenants: `<p>View and manage all active tenants. Click <em>Edit</em> to update:</p>
  <ul>
    <li>Contact info (phone, email), RV details, monthly rent, and rate type</li>
    <li><strong>Recurring monthly fees</strong> (late fee, mailbox fee, misc fee, credit/discount) — these auto-apply every time you generate invoices</li>
    <li><strong>Communication preferences</strong> — invoice delivery method (Email + SMS, Email only, SMS only, or Print/Manual)</li>
    <li><strong>Move to Different Lot</strong> — transfers the tenant with prorated billing and meter reading handoff</li>
    <li><strong>Reset Portal PIN</strong> — if a tenant forgets their portal login</li>
  </ul>
  <p>Click <em>History</em> to see a tenant's check-in/out records and payment history.</p>
  <p><em>Recurring Fees Summary</em> shows all auto-charges across tenants at a glance.</p>`,
  electric: `<p><strong>Electric Analytics</strong> shows usage trends and costs across the park.</p>
  <ul>
    <li>Top stats: average kWh/lot, highest and lowest users, average bill</li>
    <li>Line chart: usage by lot over time (toggle 3/6/12 month view)</li>
    <li><strong>Per-Lot Detail</strong>: select a lot to see its individual stats, bar chart, and readings table</li>
    <li><strong>Download PDF</strong>: generates a branded electric usage report for the selected lot</li>
    <li><strong>Text to Tenant</strong>: sends an SMS summary of the tenant's electric usage</li>
  </ul>`,
  reports: `<p><strong>Monthly Income Report:</strong></p><ol>
    <li>Select a month and year, then click <em>Generate Report</em>.</li>
    <li>View totals: collected, invoiced, outstanding, occupancy rate, electric revenue.</li>
    <li>See breakdown by rate type and top 5 highest balances.</li>
    <li><em>Print Report</em>, <em>Download PDF</em>, or <em>Download CSV</em> for spreadsheets.</li>
  </ol>
  <p><strong>Tax Reports</strong>: generates annual financial summary for tax filing.</p>
  <p><strong>Export Invoices to Excel</strong>: downloads all invoices as an .xlsx file.</p>`,
  reservations: `<p><strong>Managing reservations:</strong></p><ol>
    <li>Click <em>+ New Reservation</em> to book a single lot, or <em>Group Reservation</em> for multiple lots.</li>
    <li>Enter guest name, contact info, lot, dates, and nightly rate. Total auto-calculates.</li>
    <li>Use <em>Calendar View</em> to see all reservations on a monthly calendar, or <em>List View</em> for a table.</li>
    <li>Click <em>View</em> to see a printable confirmation, <em>Download PDF</em>, or <em>Email to Guest</em>.</li>
    <li>When the guest arrives, click <em>Check In</em> on their reservation to convert it to an active tenant.</li>
  </ol>`,
  admin: `<p><strong>System Administration:</strong></p>
  <ul>
    <li><strong>Electric Rate</strong>: set the per-kWh rate used for all meter reading charges.</li>
    <li><strong>WiFi Password</strong>: shown on the printed Welcome Card given to new tenants.</li>
    <li><strong>Eviction Settings</strong>: configure auto-SMS/email notifications when tenants are 5+ days overdue. Set manager phone/email for alerts.</li>
    <li><strong>Database Backup</strong>: download the full database as a .sqlite file. Restore from a previous backup.</li>
    <li><strong>Export All Data</strong>: download all tenants, lots, meters, payments, and invoices as an Excel file.</li>
  </ul>`
};

function helpPanel(key) {
  const content = HELP_CONTENT[key];
  if (!content) return '';
  const id = `help-${key}`;
  return `
    <div class="help-panel">
      <button class="help-toggle" onclick="toggleHelp('${id}')">
        <span class="help-icon">?</span> How To Use This Section
        <span class="help-caret" id="${id}-caret">▼</span>
      </button>
      <div class="help-body" id="${id}" style="display:none">${content}</div>
    </div>
  `;
}

function toggleHelp(id) {
  const el = document.getElementById(id);
  const caret = document.getElementById(id + '-caret');
  if (el.style.display === 'none') { el.style.display = ''; caret.textContent = '▲'; }
  else { el.style.display = 'none'; caret.textContent = '▼'; }
}

const APP_URL = window.location.origin;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showPageLoading() {
  const el = document.getElementById('page-content');
  if (el) el.innerHTML = `
    <div style="padding:0.5rem 0">
      <div class="skeleton-pulse" style="height:28px;width:200px;margin-bottom:1.5rem"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem">
        <div class="skeleton-pulse" style="height:110px"></div>
        <div class="skeleton-pulse" style="height:110px"></div>
        <div class="skeleton-pulse" style="height:110px"></div>
        <div class="skeleton-pulse" style="height:110px"></div>
      </div>
      <div class="skeleton-pulse" style="height:300px"></div>
    </div>`;
}

function showShareApp() {
  showModal('Share App', `
    <div style="text-align:center">
      <p style="margin-bottom:1rem;font-weight:600">Scan this QR code to open the app:</p>
      <div id="share-qr" style="display:inline-block;margin-bottom:1rem"></div>
      <p style="margin:1rem 0 0.5rem;font-size:0.9rem;word-break:break-all"><a href="${APP_URL}" target="_blank">${APP_URL}</a></p>
      <button class="btn btn-outline" onclick="copyAppLink()" id="copy-link-btn">&#128203; Copy Link</button>
    </div>
    <hr style="margin:1.5rem 0">
    <h4 style="margin-bottom:0.5rem">iPhone — Add to Home Screen</h4>
    <ol style="font-size:0.9rem;line-height:1.6;padding-left:1.25rem;margin-bottom:1rem">
      <li>Open the link above in <strong>Safari</strong>.</li>
      <li>Tap the <strong>Share</strong> button (square with arrow).</li>
      <li>Scroll down and tap <strong>"Add to Home Screen"</strong>.</li>
      <li>Tap <strong>Add</strong>. The app icon will appear on your home screen.</li>
    </ol>
    <h4 style="margin-bottom:0.5rem">Android — Add to Home Screen</h4>
    <ol style="font-size:0.9rem;line-height:1.6;padding-left:1.25rem">
      <li>Open the link in <strong>Chrome</strong>.</li>
      <li>Tap the <strong>Install App</strong> button if it appears, or tap the <strong>3-dot menu &rarr; "Add to Home screen"</strong>.</li>
      <li>Tap <strong>Add</strong>. The app will work like a native app with no browser bars.</li>
    </ol>
  `);
  setTimeout(() => {
    const el = document.getElementById('share-qr');
    if (el && typeof QRCode !== 'undefined') {
      new QRCode(el, { text: APP_URL, width: 200, height: 200, colorDark: '#1f2937', colorLight: '#ffffff' });
    }
  }, 50);
}

function copyAppLink() {
  navigator.clipboard?.writeText(APP_URL).then(() => {
    const btn = document.getElementById('copy-link-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.innerHTML = '&#128203; Copy Link', 2000); }
  }).catch(() => {
    prompt('Copy this link:', APP_URL);
  });
}

function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').style.display = '';
}
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }

function navigateTo(page) {
  if (!page) return; // guard against group-toggle clicks with no data-page
  // Block staff from financial pages
  if (API.user?.role === 'staff' && ['billing', 'payments', 'users', 'admin', 'waitlist', 'reports'].includes(page)) {
    alert('Access restricted. Contact your administrator.');
    return;
  }
  currentPage = page;
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`[data-page="${page}"]`);
  if (activeLink) {
    activeLink.classList.add('active');
    // Auto-expand parent nav-group if this link is inside one.
    const group = activeLink.closest('.nav-group');
    if (group) group.classList.add('open');
  }
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('open');
  // Scroll to top on page change
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Show skeleton loading
  showPageLoading();
  const loader = { dashboard: loadDashboard, sitemap: loadSiteMap, tenants: loadTenants,
    meters: loadMeters, electric: loadElectric, billing: loadBilling, payments: loadPayments,
    checkins: loadCheckins, messages: loadMessages, reservations: loadReservations, waitlist: loadWaitlist,
    users: loadUsers, reports: loadReports, admin: loadAdmin };
  if (loader[page]) {
    // Timeout fallback: if skeleton is still showing after 8s, show error
    const _skeletonTimeout = setTimeout(() => {
      const el = document.getElementById('page-content');
      if (el && currentPage === page && el.querySelector('.skeleton-pulse')) {
        el.innerHTML = `<div style="text-align:center;padding:3rem 1rem">
          <div style="font-size:2rem;margin-bottom:0.5rem">&#9888;&#65039;</div>
          <h3 style="margin-bottom:0.5rem">Page failed to load</h3>
          <p style="color:#6b7280;margin-bottom:1rem">Could not load ${escapeHtml(page)}. Check your connection and try again.</p>
          <button class="btn btn-primary" onclick="navigateTo('${page}')">Retry</button>
        </div>`;
      }
    }, 8000);
    // Clear timeout when page loads successfully (content replaces skeleton)
    const _observer = new MutationObserver(() => {
      const el = document.getElementById('page-content');
      if (el && !el.querySelector('.skeleton-pulse')) {
        clearTimeout(_skeletonTimeout);
        _observer.disconnect();
      }
    });
    _observer.observe(document.getElementById('page-content'), { childList: true, subtree: true });
    loader[page]();
  } else {
    // No handler for this page — show error immediately
    const el = document.getElementById('page-content');
    if (el) el.innerHTML = `<div style="text-align:center;padding:3rem 1rem">
      <div style="font-size:2rem;margin-bottom:0.5rem">&#9888;&#65039;</div>
      <h3>Page not found</h3>
      <p style="color:#6b7280;margin-bottom:1rem">"${escapeHtml(page)}" is not a valid page.</p>
      <button class="btn btn-primary" onclick="navigateTo('dashboard')">Go to Dashboard</button>
    </div>`;
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  // Login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    try {
      await API.login(document.getElementById('username').value, document.getElementById('password').value);
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('main-app').style.display = '';
      document.body.classList.remove('login-page');
      navigateTo('dashboard');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });

  // Password show/hide toggle (press-and-hold OR click to toggle)
  function wirePasswordToggle(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;
    const show = () => { input.type = 'text'; btn.classList.add('active'); };
    const hide = () => { input.type = 'password'; btn.classList.remove('active'); };
    // Press-and-hold (mouse + touch)
    btn.addEventListener('mousedown', show);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); show(); }, { passive: false });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => btn.addEventListener(ev, hide));
    // Click toggles (in case the user just taps)
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (input.type === 'password') show(); else hide();
    });
  }
  wirePasswordToggle('toggle-password', 'password');
  wirePasswordToggle('toggle-recover-password', 'recover-new-password');

  // Forgot password — show recovery form
  const loginForm = document.getElementById('login-form');
  const recoverForm = document.getElementById('recover-form');
  document.getElementById('forgot-password-link').addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    document.getElementById('login-error').style.display = 'none';
    recoverForm.style.display = '';
  });
  document.getElementById('back-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    recoverForm.style.display = 'none';
    document.getElementById('recover-error').style.display = 'none';
    document.getElementById('recover-success').style.display = 'none';
    loginForm.style.display = '';
  });
  recoverForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('recover-error');
    const okEl = document.getElementById('recover-success');
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('recover-username').value,
          pin: document.getElementById('recover-pin').value,
          newPassword: document.getElementById('recover-new-password').value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Recovery failed');
      okEl.style.display = '';
      recoverForm.reset();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });

  // Nav links — skip group toggles (no data-page)
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });

  // Mobile menu — toggle sidebar via either the in-sidebar button or the top hamburger
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  function openSidebar()  { sidebar.classList.add('open');    backdrop?.classList.add('open'); }
  function closeSidebar() { sidebar.classList.remove('open'); backdrop?.classList.remove('open'); }
  function toggleSidebar() {
    if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
  }
  document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('mobile-menu-btn')?.addEventListener('click', toggleSidebar);
  backdrop?.addEventListener('click', closeSidebar);

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => API.logout());

  // Change my password
  document.getElementById('change-password-btn').addEventListener('click', () => showChangeMyPassword());

  // Show Users nav entry only for admins
  function refreshUsersNavVisibility() {
    const isAdmin = API.user?.role === 'admin';
    const isStaff = API.user?.role === 'staff';
    // Admin-only nav items
    document.querySelectorAll('#nav-users, #nav-admin, #nav-reports').forEach(el => { if (el) el.style.display = isAdmin ? '' : 'none'; });
    const adminDiv = document.getElementById('nav-admin-divider');
    if (adminDiv) adminDiv.style.display = isAdmin ? '' : 'none';
    // Financial nav items — hidden for staff
    document.querySelectorAll('[data-page="billing"], [data-page="payments"]').forEach(el => {
      const li = el.closest('li');
      if (li) li.style.display = isStaff ? 'none' : '';
    });
    // Waitlist — hide for staff
    document.querySelectorAll('[data-page="waitlist"]').forEach(el => {
      const li = el.closest('li');
      if (li) li.style.display = isStaff ? 'none' : '';
    });
    // Update sidebar user info
    updateSidebarUser();
  }
  function updateSidebarUser() {
    const u = API.user;
    if (!u) return;
    const name = u.username || 'User';
    const role = u.role || 'user';
    const initials = name.slice(0, 2).toUpperCase();
    const avatarEl = document.getElementById('sidebar-avatar');
    const nameEl = document.getElementById('sidebar-username');
    const roleEl = document.getElementById('sidebar-role');
    if (avatarEl) avatarEl.textContent = initials;
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role === 'admin' ? 'Administrator' : role === 'staff' ? 'Staff' : 'Manager';
  }
  refreshUsersNavVisibility();
  // Re-check after login
  const origLogin = API.login.bind(API);
  API.login = async (...args) => {
    const r = await origLogin(...args);
    refreshUsersNavVisibility();
    return r;
  };

  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Payment links now go to /pay.html — if someone hits /?pay= redirect them.
  const params = new URLSearchParams(location.search);
  if (params.get('pay')) {
    window.location.href = '/pay.html?pay=' + params.get('pay');
    return;
  }

  if (params.get('paid') === '1') {
    setTimeout(() => showCelebration('🎉💰', `Paid in Full! Invoice ${params.get('invoice') || ''}`), 200);
    history.replaceState({}, '', location.pathname);
  } else if (params.get('paid') === 'cancelled') {
    setTimeout(() => alert(`Payment cancelled for invoice ${params.get('invoice') || ''}.`), 200);
    history.replaceState({}, '', location.pathname);
  }

  // Auto-login if token exists
  if (API.token) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = '';
    document.body.classList.remove('login-page');
    navigateTo('dashboard');
  }
});
