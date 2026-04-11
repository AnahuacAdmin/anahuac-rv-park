let currentPage = 'dashboard';

// --- Fun UI Celebrations & Status Toasts ---
function showCelebration(emoji, text, duration = 3000) {
  const el = document.createElement('div');
  el.className = 'celebration-overlay';
  el.innerHTML = `<div class="celebration-content"><div class="celebration-emoji">${emoji}</div><div class="celebration-text">${text}</div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, duration);
}

function showStatusToast(emoji, text) {
  let el = document.getElementById('status-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'status-toast';
    el.className = 'status-toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `${emoji} ${text}`;
  el.classList.add('visible');
  return {
    update: (newEmoji, newText) => { el.innerHTML = `${newEmoji} ${newText}`; },
    hide: (delay = 2000) => { setTimeout(() => { el.classList.remove('visible'); }, delay); },
  };
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
  '💡 Use the Tax Reports button in Billing for a year-end financial summary.',
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
      html += g.items.map(it => `<div class="search-result" onclick="${it.action}; closeSearch()"><div><div class="sr-title">${it.title}</div><div class="sr-sub">${it.sub}</div></div></div>`).join('');
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
  dashboard: `<p><strong>Overview of park status.</strong> Check daily for outstanding balances, meter reading progress, and recent activity. Use quick action buttons to navigate to any module.</p>`,
  checkins: `<p><strong>Checking in a new tenant:</strong></p><ol>
    <li>Click <em>Check-In New Tenant</em>.</li>
    <li>Select an available lot from the dropdown.</li>
    <li>Enter tenant full name, phone, email, date of birth and ID type.</li>
    <li>Enter RV details — make, model, year, length and license plate.</li>
    <li>Set move-in date, monthly rate, deposit amount and take initial meter reading.</li>
    <li>Have tenant acknowledge all lease terms by checking each box.</li>
    <li>Click <em>Complete Check-In</em>. Tenant is now active in the system.</li>
  </ol>
  <p><strong>Checking out a tenant:</strong></p><ol>
    <li>Go to Check-In/Out module and click the <em>Check-Out</em> tab.</li>
    <li>Select the tenant lot from the dropdown.</li>
    <li>Enter the move-out date.</li>
    <li>Take a final meter reading and enter it.</li>
    <li>Select reason for leaving.</li>
    <li>Enter forwarding address.</li>
    <li>Enter any deposit deductions for damages or cleaning with a description.</li>
    <li>System will calculate deposit refund automatically.</li>
    <li>Click <em>Process Check-Out</em>. Lot will be marked vacant automatically.</li>
  </ol>`,
  meters: `<ol>
    <li>On the 1st of each month go to Meter Readings.</li>
    <li>For each occupied lot enter the current meter reading number shown on the physical meter.</li>
    <li>Previous reading auto-fills from last month.</li>
    <li>System calculates kWh used and electric charge automatically.</li>
    <li>Click <em>Save</em> after each entry or <em>Save All</em> at the bottom.</li>
    <li>Readings feed directly into billing.</li>
  </ol>`,
  billing: `<ol>
    <li>After all meter readings are entered click <em>Generate Monthly Invoices</em>.</li>
    <li>Review each invoice for accuracy.</li>
    <li>Add any one-time fees, late fees or credits by clicking <em>Edit</em> on the invoice.</li>
    <li>Click <em>Print</em> or <em>View</em> to see the formatted invoice with logo.</li>
    <li>Hand or mail invoice to tenant.</li>
  </ol>`,
  payments: `<ol>
    <li>When a tenant pays click <em>Log Payment</em> on their row.</li>
    <li>Enter amount paid, payment method (Cash, Check, Money Order, or Credit/Debit Card — 3% convenience fee applies to card) and date.</li>
    <li>System updates balance automatically.</li>
    <li>Filter by <em>Unpaid</em> to see who still owes.</li>
  </ol>`,
  messages: `<ol>
    <li>Select message type from dropdown.</li>
    <li>Choose recipients — individual tenant, all tenants, or all unpaid.</li>
    <li>Template auto-fills but can be edited.</li>
    <li>Click <em>Send</em> to save message record.</li>
    <li>Click <em>Print</em> to print a physical notice to hand to tenant.</li>
  </ol>`,
  waitlist: `<ol>
    <li>Click <em>Add to Waitlist</em> to add a new prospect.</li>
    <li>Fill in contact info, RV size and estimated move-in date.</li>
    <li>When a lot opens click <em>Assign</em> next to the prospect name.</li>
    <li>Enter the lot number.</li>
    <li>Go to Check-In to complete the move-in process.</li>
  </ol>`,
  sitemap: `<p>Click any lot to view tenant details. Colors show status — <strong>orange</strong> is occupied, <strong>yellow</strong> is vacant, <strong>blue</strong> is reserved.</p>`,
  tenants: `<p>Manage all active tenants. Click <em>Edit</em> to update contact info, RV details, monthly rent, or <strong>recurring monthly fees</strong> (late fee, mailbox fee, misc fee, credit/discount) that auto-apply each time monthly invoices are generated.</p>`
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

const APP_URL = 'https://web-production-89794.up.railway.app';

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
  const loader = { dashboard: loadDashboard, sitemap: loadSiteMap, tenants: loadTenants,
    meters: loadMeters, billing: loadBilling, payments: loadPayments,
    checkins: loadCheckins, messages: loadMessages, reservations: loadReservations, waitlist: loadWaitlist,
    users: loadUsers, admin: loadAdmin };
  if (loader[page]) loader[page]();
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

  // Nav links
  document.querySelectorAll('.nav-link').forEach(link => {
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
    const u = document.getElementById('nav-users');
    const a = document.getElementById('nav-admin');
    if (u) u.style.display = isAdmin ? '' : 'none';
    if (a) a.style.display = isAdmin ? '' : 'none';
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
