let currentPage = 'dashboard';

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
    <li>Enter amount paid, payment method (Cash/Check/Venmo/Zelle) and date.</li>
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

function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').style.display = '';
}
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('open');
  const loader = { dashboard: loadDashboard, sitemap: loadSiteMap, tenants: loadTenants,
    meters: loadMeters, billing: loadBilling, payments: loadPayments,
    checkins: loadCheckins, messages: loadMessages, waitlist: loadWaitlist };
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

  // Mobile menu
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => API.logout());

  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Auto-login if token exists
  if (API.token) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = '';
    navigateTo('dashboard');
  }
});
