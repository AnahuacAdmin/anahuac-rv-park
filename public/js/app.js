/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
let currentPage = 'dashboard';
const _navHistory = [];
localStorage.setItem('hasSeenTour', '1'); // Permanently disable welcome tour

function goBack() {
  if (_navHistory.length === 0) return;
  const prev = _navHistory.pop();
  navigateTo(prev, true); // true = don't push to history
}

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

// --- Spellcheck: auto-enable on all text fields ---
function enableSpellcheck(root) {
  (root || document).querySelectorAll('textarea, input[type="text"], input:not([type])').forEach(function(el) {
    el.setAttribute('spellcheck', 'true');
    el.setAttribute('lang', 'en');
  });
}
// Run on page load and observe DOM changes for dynamically added fields
enableSpellcheck();
new MutationObserver(function(mutations) {
  for (var m of mutations) {
    for (var n of m.addedNodes) {
      if (n.nodeType === 1) enableSpellcheck(n);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

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
  dashboard: `<p><strong>📊 Your Command Center</strong></p><ul>
    <li>View park occupancy, revenue, and outstanding balances at a glance.</li>
    <li><strong>Quick Actions:</strong> shortcuts to common tasks like meter readings, invoices, check-ins.</li>
    <li><strong>System Health:</strong> monitor Stripe, Twilio, and database status.</li>
    <li>Click the <strong>🐊 Tenant Portal</strong> button to view what tenants see.</li>
    <li>Click the <strong>🔄 refresh button</strong> (top right) to update data anytime.</li>
    <li><strong>Staff view:</strong> Staff members see occupancy and tenant info but not financial data.</li>
  </ul>`,
  checkins: `<p><strong>🏕️ Checking In a New Tenant:</strong></p><ol>
    <li>Click <em>Check-In</em>.</li>
    <li>Enter tenant's full name, phone, and email.</li>
    <li>Select their lot number from the dropdown.</li>
    <li>Choose rate type: <strong>Daily</strong> ($50), <strong>Weekly</strong> ($200), or <strong>Monthly</strong> ($295).</li>
    <li>If moving in mid-month, the prorated amount calculates automatically.</li>
    <li>Enter deposit amount collected.</li>
    <li>Toggle <strong>Flat Rate</strong> if this tenant pays one fixed amount for everything.</li>
    <li>Enter vehicle/RV information and emergency contact.</li>
    <li>Click <em>Check In</em> — a celebration will appear! 🎉</li>
    <li>After check-in: <strong>Send Welcome Text</strong> or <strong>Print Welcome Card</strong> with WiFi, rules, and QR payment code.</li>
  </ol>
  <p><strong>🚪 Checking Out a Tenant:</strong></p><ol>
    <li>Select the tenant from the dropdown.</li>
    <li>Enter move-out date.</li>
    <li>Choose deposit settlement: <strong>Full Refund</strong>, <strong>Partial Refund</strong> (deduct damages), <strong>Apply to Balance</strong>, or <strong>No Refund</strong>.</li>
    <li>A <strong>Move-Out Statement</strong> will be generated — print it for your records.</li>
  </ol>`,
  meters: `<p><strong>⚡ Two Ways to Enter Readings:</strong></p>
  <p><strong>Table Mode</strong> (desktop):</p><ol>
    <li>Click any <strong>Current Reading</strong> or <strong>Date</strong> cell to edit inline.</li>
    <li>kWh and charge recalculate automatically.</li>
    <li><em>+ Quick Add</em> to select a lot and enter a reading fast.</li>
    <li>Camera icon shows attached meter photos.</li>
  </ol>
  <p><strong>📱 Mobile Entry</strong> (walking the park):</p><ol>
    <li>Click <em>Mobile Entry</em> — one lot at a time, phone-friendly.</li>
    <li><strong>Take a photo</strong> of each meter as proof.</li>
    <li>Enter reading — kWh and charge calculate instantly.</li>
    <li>Click <em>Save</em> and it auto-advances to next lot.</li>
    <li>Progress bar tracks completion.</li>
  </ol>
  <p>💡 <strong>TIP:</strong> Use Mobile Entry mode when walking the property with your phone!</p>`,
  billing: `<p><strong>🧾 Managing Billing</strong></p>
  <p><strong>Generating Invoices:</strong></p><ol>
    <li>Click <em>Generate Monthly Invoices</em> at the start of each month.</li>
    <li>System creates invoices for ALL active tenants automatically.</li>
    <li>Flat rate tenants get their fixed amount (electric skipped).</li>
    <li>Prorated invoices created for mid-month move-ins.</li>
  </ol>
  <p><strong>Sending & Managing:</strong></p><ul>
    <li>Click <em>Email</em> to send with PDF attachment and payment link.</li>
    <li>Click <em>SMS</em> to text a summary to the tenant.</li>
    <li>Click directly on <strong>fees, refund, or notes</strong> cells to edit inline.</li>
    <li><em>Check Late Fees</em> auto-applies $25 to invoices 3+ days overdue.</li>
    <li><em>Pay Now</em> opens Stripe online payment (3% convenience fee shown on button).</li>
    <li>Deleted invoices can be restored using <em>Show Deleted</em> checkbox.</li>
  </ul>
  <p><strong>Color Coding:</strong> 🟢 Paid &nbsp; 🟡 Partial &nbsp; 🔴 Unpaid &nbsp; <span style="background:#dcfce7;color:#166534;padding:1px 6px;border-radius:10px;font-size:0.75rem">FLAT RATE</span> &nbsp; <span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:10px;font-size:0.75rem">PRORATED</span></p>
  <p><strong>Tax Reports</strong> and <strong>Export to Excel</strong> are on the <em>Reports</em> page.</p>`,
  payments: `<p><strong>💳 Recording Payments</strong></p><ol>
    <li>Click <em>Log Payment</em> on any invoice row.</li>
    <li>Enter amount, method (Cash, Check, Money Order, or Card — 3% fee applies), and date.</li>
    <li>An <strong>SMS receipt</strong> is automatically sent to the tenant.</li>
    <li>System updates balance automatically. Overpayments become <strong>tenant credit</strong>.</li>
    <li>Filter by <em>Unpaid</em> to see who still owes.</li>
  </ol>
  <p>Tenants can also pay online via the <strong>Tenant Portal</strong> or the payment link in their invoice email.</p>`,
  messages: `<p><strong>📱 Messaging Options:</strong></p><ul>
    <li><strong>Send Message</strong> — send to one tenant (record only, or via SMS).</li>
    <li><strong>Broadcast to All</strong> — message all tenants at once. Confirm before sending!</li>
    <li><strong>Send Notification</strong> — advanced: choose a template (Late Payment, Weather Emergency, Power Outage, General, Custom), pick recipients, deliver via SMS, Email, or both.</li>
    <li><strong>📲 Share Tenant Portal</strong> — text the portal login link so tenants can view invoices and pay online.</li>
  </ul>
  <p>When a tenant replies to your text, it forwards to your phone and is logged here.</p>`,
  waitlist: `<ol>
    <li>Click <em>+ Add to Waitlist</em> to add a prospective tenant.</li>
    <li>Fill in contact info, RV length, and preferred lot.</li>
    <li>Track status: <strong>Waiting</strong> → <strong>Contacted</strong> → <strong>Placed</strong>.</li>
    <li>When a lot opens, update status, then go to <em>Check-In/Out</em> to move them in.</li>
  </ol>`,
  sitemap: `<p><strong>🗺️ Reading the Site Map</strong></p>
  <p>Click any lot card to see tenant details, billing, payments, and meter history.</p>
  <p><strong>Color Codes:</strong></p><ul>
    <li>🟢 <strong>Green border</strong> = Occupied</li>
    <li>🟢 <strong>Green fill</strong> = Vacant / Available</li>
    <li>⬜ <strong>Gray</strong> = Owner Reserved</li>
    <li>🔴 <strong>Red border + glow</strong> = Unpaid / Overdue balance</li>
    <li>🟡 <strong>Yellow border</strong> = Partial payment</li>
    <li><span style="background:#dcfce7;color:#166534;padding:1px 6px;border-radius:10px;font-size:0.75rem">FLAT RATE</span> = Flat rate billing</li>
  </ul>
  <p>Admin view shows balance amounts and payment flags on each lot.</p>`,
  tenants: `<p><strong>👤 Managing Tenants</strong></p>
  <p>Click <em>Edit</em> to update:</p><ul>
    <li>Contact info, RV details, rent amount, and rate type</li>
    <li><strong>Flat Rate Billing</strong> — one fixed monthly amount covering everything</li>
    <li><strong>Recurring monthly fees</strong> — late fee, mailbox, misc, credit/discount (auto-apply on invoice generation)</li>
    <li><strong>Communication preferences</strong> — Email+SMS, Email only, SMS only, or Print</li>
    <li><strong>Move to Different Lot</strong> — transfers with prorated billing</li>
    <li><strong>Reset Portal PIN</strong> — if tenant forgets their login</li>
  </ul>
  <p>Click <em>History</em> for check-in/out records and payment history.</p>
  <p><em>Recurring Fees Summary</em> shows all auto-charges at a glance.</p>`,
  electric: `<p><strong>⚡ Electric Usage Analytics</strong></p><ul>
    <li><strong>Park overview:</strong> multi-line chart shows all lots over time (toggle 3/6/12 months).</li>
    <li><strong>Stats bar:</strong> park average, highest/lowest usage lots.</li>
    <li><strong>Per-Lot Detail:</strong> select a lot for individual stats, bar chart, and readings table.</li>
    <li><strong>📄 Download PDF:</strong> branded electric report for the selected lot.</li>
    <li><strong>📱 Text to Tenant:</strong> SMS usage summary — great when tenants question their bill!</li>
  </ul>`,
  reports: `<p><strong>📊 Reports</strong></p>
  <p><strong>Monthly Income Report:</strong></p><ol>
    <li>Select month/year, click <em>Generate Report</em>.</li>
    <li>View: collected, invoiced, outstanding, occupancy rate, electric revenue.</li>
    <li>Breakdown by rate type and top 5 highest balances.</li>
    <li>Export as <em>PDF</em>, <em>CSV</em>, or print directly.</li>
  </ol>
  <p><strong>Tax Reports:</strong> annual financial summary for tax filing.</p>
  <p><strong>Export to Excel:</strong> all invoice data as .xlsx spreadsheet.</p>`,
  reservations: `<p><strong>📅 Managing Reservations</strong></p><ol>
    <li><em>+ New Reservation</em> for single lot, <em>Group Reservation</em> for multiple lots.</li>
    <li>Enter guest name, contact, lot, dates, nightly rate. Total auto-calculates.</li>
    <li><em>Calendar View</em> shows reservations on a monthly grid.</li>
    <li><em>View</em> for printable confirmation, <em>PDF</em>, or <em>Email to Guest</em>.</li>
    <li>When guest arrives, click <em>Check In</em> to convert to active tenant.</li>
  </ol>`,
  admin: `<p><strong>⚙️ System Settings</strong></p><ul>
    <li><strong>Electric Rate:</strong> per-kWh rate for all meter calculations.</li>
    <li><strong>Flat Rate Billing:</strong> default flat rate, apply to all/by row, manage flat rate tenants.</li>
    <li><strong>WiFi Password:</strong> included on Welcome Cards.</li>
    <li><strong>Eviction Settings:</strong> auto-SMS/email when 5+ days overdue.</li>
    <li><strong>Downtime Alerts:</strong> SMS notifications to managers when services go down.</li>
    <li><strong>Offline Mode:</strong> view pending sync items, force sync, clear cache.</li>
    <li><strong>Database Backup:</strong> download/restore .sqlite file.</li>
    <li><strong>Export All Data:</strong> full Excel export of all tables.</li>
    <li><strong>🖨️ Emergency Forms:</strong> printable check-in, meter reading, and payment forms for when internet is down.</li>
  </ul>`,
  lotmgmt: `<p><strong>🏕️ What is Lot Management?</strong></p>
  <p>Lot Management allows you to add, edit, and organize all the lots in your RV park. Changes made here automatically update everywhere — Site Map, Meter Readings, Check-In, and all dropdowns.</p>
  <p><strong>➕ Adding a New Lot:</strong></p><ol>
    <li>Click <em>+ Add New Lot</em>.</li>
    <li>Enter the Lot ID (example: A1, B3, H6).</li>
    <li>Select the Row letter (A, B, C...).</li>
    <li>Choose the lot type: Standard, Premium, Pull-Through, or Owner Reserved.</li>
    <li>Enter the lot size (example: 30ft × 60ft).</li>
    <li>Check which amenities are available: 30amp, 50amp, Water, Sewer, WiFi.</li>
    <li>Set a default monthly rate for this lot.</li>
    <li>Add any notes about the lot.</li>
    <li>Click Save — the lot appears everywhere instantly!</li>
  </ol>
  <p><strong>✏️ Editing a Lot:</strong></p><ul>
    <li>Click <em>Edit</em> on any lot to update its details.</li>
    <li>Change the type, size, amenities, or rate at any time.</li>
    <li>Changes take effect immediately across the entire app.</li>
  </ul>
  <p><strong>🚫 Deactivating a Lot:</strong></p><ul>
    <li>Click <em>Deactivate</em> to mark a lot as unavailable.</li>
    <li>Deactivated lots won't show in Check-In or Site Map.</li>
    <li>You can reactivate them anytime — no data is lost.</li>
  </ul>
  <p><strong>💡 Tips:</strong></p><ul>
    <li>Lot IDs must be unique (no two lots can have the same ID).</li>
    <li>Adding a new row letter automatically creates that row on the Site Map.</li>
    <li>Default rates auto-fill when checking in a new tenant to that lot.</li>
    <li>Owner Reserved lots show as reserved on the Site Map and cannot be checked in.</li>
    <li><strong>Renaming a lot:</strong> Click Edit → 🏷️ Rename/Relabel to change a lot's ID. All tenant records, invoices, meter readings, and reservations are updated automatically. Type CONFIRM to proceed.</li>
  </ul>`,
  vendors: `<p><strong>📒 Vendor Directory</strong></p><ul>
    <li>Add plumbers, electricians, suppliers, and other contacts you call regularly.</li>
    <li>Tap ⭐ to mark favorites — they show first and appear on the dashboard.</li>
    <li>Tap 📞 to call directly from your phone.</li>
    <li>Tap 📍 Directions to get Google Maps directions from the park.</li>
    <li>Search and filter by category to find vendors fast.</li>
  </ul>`,
  users: `<p><strong>👥 Managing Users</strong></p>
  <p><strong>Roles:</strong></p><ul>
    <li><strong>Admin:</strong> full access to everything including financials, settings, and user management.</li>
    <li><strong>Staff:</strong> can do meter readings, check-ins, messaging — but CANNOT see billing, payments, balances, or reports.</li>
  </ul>
  <p><strong>Creating a staff account:</strong></p><ol>
    <li>Click <em>+ New User</em>.</li>
    <li>Enter username and temporary password.</li>
    <li>Select role: Staff or Admin.</li>
    <li>Share login URL and credentials with them.</li>
    <li>They should change their password on first login.</li>
  </ol>`
};

// --- Welcome Tour (DISABLED) ---
function showWelcomeTour() { localStorage.setItem('hasSeenTour','1'); return; }

// --- Keyboard Shortcuts ---
function showKeyboardShortcuts() {
  showModal('⌨️ Keyboard Shortcuts', `
    <table style="width:100%;font-size:0.9rem">
      <tbody>
        <tr><td style="padding:0.3rem 0.5rem"><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;border:1px solid var(--gray-300);font-family:monospace">D</kbd></td><td>Dashboard</td></tr>
        <tr><td style="padding:0.3rem 0.5rem"><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;border:1px solid var(--gray-300);font-family:monospace">S</kbd></td><td>Site Map</td></tr>
        <tr><td style="padding:0.3rem 0.5rem"><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;border:1px solid var(--gray-300);font-family:monospace">T</kbd></td><td>Tenants</td></tr>
        <tr><td style="padding:0.3rem 0.5rem"><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;border:1px solid var(--gray-300);font-family:monospace">M</kbd></td><td>Meter Readings</td></tr>
        <tr><td style="padding:0.3rem 0.5rem"><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;border:1px solid var(--gray-300);font-family:monospace">B</kbd></td><td>Billing</td></tr>
        <tr><td style="padding:0.3rem 0.5rem"><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;border:1px solid var(--gray-300);font-family:monospace">R</kbd></td><td>Reports</td></tr>
        <tr><td style="padding:0.3rem 0.5rem"><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;border:1px solid var(--gray-300);font-family:monospace">?</kbd></td><td>Show this help</td></tr>
        <tr><td style="padding:0.3rem 0.5rem"><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;border:1px solid var(--gray-300);font-family:monospace">Alt+←</kbd></td><td>Go back</td></tr>
        <tr><td style="padding:0.3rem 0.5rem"><kbd style="background:var(--gray-100);padding:2px 8px;border-radius:4px;border:1px solid var(--gray-300);font-family:monospace">Esc</kbd></td><td>Close modal</td></tr>
      </tbody>
    </table>
  `);
}

document.addEventListener('keydown', (e) => {
  // Don't fire when typing in inputs/textareas
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (document.getElementById('modal-overlay')?.style.display !== 'none') {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); return; }
  const map = { 'd': 'dashboard', 's': 'sitemap', 't': 'tenants', 'm': 'meters', 'b': 'billing', 'r': 'reports' };
  if (map[e.key]) { e.preventDefault(); navigateTo(map[e.key]); }
  if (e.key === '?') { e.preventDefault(); showKeyboardShortcuts(); }
});

// --- Contextual First-Visit Tips ---
function showFirstVisitTip(page, emoji, tip) {
  const key = 'tip_seen_' + page;
  if (localStorage.getItem(key)) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:3000;max-width:320px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;padding:0.75rem 1rem;box-shadow:0 4px 16px rgba(0,0,0,0.12);font-size:0.85rem;color:#92400e;animation:fadeIn 0.3s ease-out';
  el.innerHTML = `<div style="display:flex;gap:0.5rem;align-items:flex-start"><span style="font-size:1.1rem;flex-shrink:0">${emoji}</span><div style="flex:1"><strong>TIP:</strong> ${tip}</div><button onclick="this.parentElement.parentElement.remove();localStorage.setItem('${key}','1')" style="background:none;border:none;color:#d97706;font-size:1.1rem;cursor:pointer;padding:0 0.25rem;flex-shrink:0">&times;</button></div>`;
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentElement) { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); localStorage.setItem(key, '1'); } }, 10000);
}

function helpPanel(key) {
  const content = HELP_CONTENT[key];
  if (!content) return backButtonHtml();
  const id = `help-${key}`;
  return `
    ${backButtonHtml()}
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

function openPortalPreview() {
  var win = window.open('/portal.html', '_blank');
  if (!win) window.location.href = '/portal.html';
}

function spinAndReload(btn) {
  btn.classList.add('spinning');
  setTimeout(function() { window.location.reload(); }, 600);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function backButtonHtml() {
  if (_navHistory.length === 0) return '';
  return '<button onclick="goBack()" class="back-btn">← Back</button>';
}

function showPageLoading() {
  const el = document.getElementById('page-content');
  if (el) el.innerHTML = `
    ${backButtonHtml()}
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

function navigateTo(page, skipHistory) {
  if (!page) return; // guard against group-toggle clicks with no data-page
  // Block staff from financial pages
  if (API.user?.role === 'staff' && ['billing', 'payments', 'users', 'admin', 'waitlist', 'reports', 'lotmgmt'].includes(page)) {
    alert('Access restricted. Contact your administrator.');
    return;
  }
  // Push current page to history (no duplicates)
  if (!skipHistory && currentPage && currentPage !== page) {
    if (_navHistory[_navHistory.length - 1] !== currentPage) {
      _navHistory.push(currentPage);
      if (_navHistory.length > 10) _navHistory.shift();
    }
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
    users: loadUsers, reports: loadReports, admin: loadAdmin, lotmgmt: loadLotMgmt, vendors: loadVendors };
  // Contextual first-visit tips
  const _tips = {
    dashboard: ['💡', 'Bookmark this page for quick access! Use the Quick Action buttons to jump to any section.'],
    billing: ['💡', 'Generate invoices on the 1st of each month. Click any fee cell to edit it inline!'],
    meters: ['💡', 'Use Mobile Entry mode when walking the property with your phone — much faster!'],
    sitemap: ['💡', 'Click any lot card to quickly see that tenant\'s full details, billing, and history.'],
    checkins: ['💡', 'After check-in, send a Welcome Text and print a Welcome Card for your new tenant.'],
  };
  if (_tips[page]) setTimeout(() => showFirstVisitTip(page, _tips[page][0], _tips[page][1]), 2000);

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
      // Force-show refresh button
      var rb = document.getElementById('refreshBtn');
      if (rb) { rb.style.display = 'flex'; rb.onclick = function() { location.reload(); }; }
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
    document.querySelectorAll('#nav-users, #nav-admin, #nav-reports, #nav-lotmgmt, #nav-vendors').forEach(el => { if (el) el.style.display = isAdmin ? '' : 'none'; });
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
    var rb2 = document.getElementById('refreshBtn');
    if (rb2) { rb2.style.display = 'flex'; rb2.onclick = function() { location.reload(); }; }
    navigateTo('dashboard');
  }
});
