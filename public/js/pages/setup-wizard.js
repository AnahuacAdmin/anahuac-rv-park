/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * First-Time Setup Wizard
 */

var _wizardStep = 1;
var _wizardData = {};
var WIZARD_STEPS = 5;

async function shouldShowSetupWizard() {
  // Only show for admin users when setup hasn't been completed
  if (!API.token || API.user?.role !== 'admin') return false;
  try {
    var s = await API.get('/settings');
    // Show wizard if not completed AND park name is still default or empty
    if (s.setup_wizard_completed === '1') return false;
    if (s.park_name && s.park_name !== 'Anahuac RV Park' && s.park_name.trim() !== '') return false;
    return true;
  } catch { return false; }
}

function showSetupWizard() {
  _wizardStep = 1;
  _wizardData = {};
  var el = document.getElementById('setup-wizard');
  if (!el) return;
  el.style.display = '';
  document.getElementById('main-app').style.display = 'none';
  renderWizardStep();
}

function hideSetupWizard() {
  var el = document.getElementById('setup-wizard');
  if (el) el.style.display = 'none';
  document.getElementById('main-app').style.display = '';
}

function skipSetupWizard() {
  // Mark as completed so it never shows again
  API.put('/settings', { setup_wizard_completed: '1' }).catch(function() {});
  hideSetupWizard();
  if (typeof applyBranding === 'function') applyBranding();
  navigateTo('dashboard');
}

function renderWizardStep() {
  var body = document.getElementById('wizard-body');
  if (!body) return;

  // Progress bar
  var pct = Math.round((_wizardStep / WIZARD_STEPS) * 100);
  var progress = '<div style="margin-bottom:2rem">' +
    '<div style="display:flex;justify-content:space-between;font-size:0.78rem;color:#78716c;margin-bottom:0.4rem">' +
      '<span>Step ' + _wizardStep + ' of ' + WIZARD_STEPS + '</span>' +
      '<span>' + pct + '%</span>' +
    '</div>' +
    '<div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">' +
      '<div style="height:100%;width:' + pct + '%;background:var(--brand-primary,#1a5c32);border-radius:3px;transition:width 0.4s ease"></div>' +
    '</div>' +
  '</div>';

  var content = '';
  var nav = '';

  if (_wizardStep === 1) {
    // Welcome
    content = '<div style="text-align:center;padding:1rem 0">' +
      '<div style="font-size:3rem;margin-bottom:1rem">🏕️</div>' +
      '<h2 style="color:var(--gray-900);font-size:1.5rem;margin-bottom:0.75rem">Welcome to LotMate!</h2>' +
      '<p style="color:var(--gray-600);font-size:1rem;line-height:1.6;max-width:420px;margin:0 auto">Let\'s get your park set up in about <strong>5 minutes</strong>. We\'ll walk you through the basics — you can always change everything later.</p>' +
    '</div>';
    nav = '<div style="display:flex;justify-content:center;margin-top:2rem">' +
      '<button class="btn btn-primary" style="padding:0.75rem 2.5rem;font-size:1rem" onclick="wizardNext()">Let\'s Go! →</button>' +
    '</div>';

  } else if (_wizardStep === 2) {
    // Park info
    content = '<h2 style="color:var(--gray-900);font-size:1.25rem;margin-bottom:0.25rem">Tell us about your park</h2>' +
      '<p style="color:var(--gray-500);font-size:0.85rem;margin-bottom:1.25rem">This info shows on invoices, the tenant portal, and reports.</p>' +
      '<div class="form-group"><label>Park Name *</label><input id="wiz-park-name" value="' + _escWiz(_wizardData.park_name || '') + '" placeholder="e.g. Sunny Acres RV Park" required></div>' +
      '<div class="form-group"><label>Address</label><input id="wiz-park-address" value="' + _escWiz(_wizardData.park_address || '') + '" placeholder="123 Main St, City, TX 77000"></div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label>Phone</label><input id="wiz-park-phone" value="' + _escWiz(_wizardData.park_phone || '') + '" placeholder="555-123-4567"></div>' +
        '<div class="form-group"><label>Email</label><input id="wiz-park-email" type="email" value="' + _escWiz(_wizardData.park_email || '') + '" placeholder="office@mypark.com"></div>' +
      '</div>' +
      '<div class="form-group"><label>Website <span style="color:var(--gray-400)">(optional)</span></label><input id="wiz-park-website" value="' + _escWiz(_wizardData.park_website || '') + '" placeholder="https://mypark.com"></div>';
    nav = wizardNav(true);

  } else if (_wizardStep === 3) {
    // Lot setup
    content = '<h2 style="color:var(--gray-900);font-size:1.25rem;margin-bottom:0.25rem">Set up your lots</h2>' +
      '<p style="color:var(--gray-500);font-size:0.85rem;margin-bottom:1.25rem">We\'ll auto-create your lots (A-1, A-2, B-1, etc.). You can rename, edit, or add more anytime from Lot Management.</p>' +
      '<div class="form-row">' +
        '<div class="form-group"><label>How many lots? *</label><input id="wiz-lot-count" type="number" min="1" max="500" value="' + (_wizardData.lot_count || '') + '" placeholder="e.g. 30"></div>' +
        '<div class="form-group"><label>Standard monthly rate ($)</label><input id="wiz-monthly-rate" type="number" step="0.01" value="' + (_wizardData.default_monthly_rate || '295') + '" placeholder="295"></div>' +
      '</div>' +
      '<div class="form-group"><label>Electric rate per kWh ($)</label><input id="wiz-electric-rate" type="number" step="0.01" value="' + (_wizardData.electric_rate || '0.15') + '" placeholder="0.15"></div>' +
      '<div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:8px;padding:0.75rem 1rem;margin-top:0.75rem;font-size:0.82rem;color:#065f46">' +
        '💡 Don\'t worry about getting this perfect — you can edit individual lot sizes, rates, and labels from the <strong>Lot Management</strong> page anytime.' +
      '</div>';
    nav = wizardNav(true);

  } else if (_wizardStep === 4) {
    // Admin account
    content = '<h2 style="color:var(--gray-900);font-size:1.25rem;margin-bottom:0.25rem">Your admin account</h2>' +
      '<p style="color:var(--gray-500);font-size:0.85rem;margin-bottom:1.25rem">Set a strong password. If you don\'t change it now, you can always change it later from the sidebar.</p>' +
      '<div class="form-group"><label>Your Full Name</label><input id="wiz-admin-name" value="' + _escWiz(_wizardData.admin_name || '') + '" placeholder="e.g. John Smith"></div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label>New Password <span style="color:var(--gray-400)">(optional)</span></label><input id="wiz-password" type="password" placeholder="Leave blank to keep current" minlength="6"></div>' +
        '<div class="form-group"><label>Confirm Password</label><input id="wiz-password-confirm" type="password" placeholder="Confirm new password"></div>' +
      '</div>' +
      '<div id="wiz-pw-error" class="error-text" style="display:none"></div>';
    nav = wizardNav(true);

  } else if (_wizardStep === 5) {
    // Summary + finish
    content = '<div style="text-align:center;padding:0.5rem 0">' +
      '<div style="font-size:3rem;margin-bottom:0.75rem">🎉</div>' +
      '<h2 style="color:var(--gray-900);font-size:1.5rem;margin-bottom:0.5rem">All done!</h2>' +
      '<p style="color:var(--gray-500);font-size:0.92rem;margin-bottom:1.5rem">Here\'s a summary of your setup:</p>' +
    '</div>' +
    '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;margin-bottom:1.5rem;font-size:0.88rem">' +
      '<table style="width:100%;border-collapse:collapse">' +
        wizSummaryRow('Park Name', _wizardData.park_name) +
        wizSummaryRow('Address', _wizardData.park_address) +
        wizSummaryRow('Phone', _wizardData.park_phone) +
        wizSummaryRow('Email', _wizardData.park_email) +
        wizSummaryRow('Lots', _wizardData.lot_count ? _wizardData.lot_count + ' lots' : 'Skipped') +
        wizSummaryRow('Monthly Rate', _wizardData.default_monthly_rate ? '$' + _wizardData.default_monthly_rate : '') +
        wizSummaryRow('Electric Rate', _wizardData.electric_rate ? '$' + _wizardData.electric_rate + '/kWh' : '') +
        wizSummaryRow('Password', _wizardData.new_password ? 'Changed ✓' : 'Unchanged') +
      '</table>' +
    '</div>' +
    '<div style="text-align:center">' +
      '<button class="btn btn-primary" style="padding:0.85rem 2.5rem;font-size:1.1rem" onclick="finishSetupWizard()">Take me to my dashboard →</button>' +
      '<p style="color:var(--gray-500);font-size:0.78rem;margin-top:1rem">You can always update these settings in the <strong>Park Branding</strong> and <strong>Admin</strong> pages.</p>' +
    '</div>';
    nav = '';
  }

  body.innerHTML = progress + content + nav +
    (_wizardStep < 5 ? '<div style="text-align:center;margin-top:1.5rem"><a href="#" onclick="event.preventDefault();skipSetupWizard()" style="color:var(--gray-400);font-size:0.78rem;text-decoration:none">Skip setup →</a></div>' : '');
}

function _escWiz(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wizSummaryRow(label, value) {
  return '<tr>' +
    '<td style="padding:0.35rem 0.5rem;color:var(--gray-500);font-weight:500;width:140px">' + label + '</td>' +
    '<td style="padding:0.35rem 0.5rem;color:var(--gray-800)">' + _escWiz(value || '—') + '</td>' +
  '</tr>';
}

function wizardNav(showBack) {
  return '<div style="display:flex;justify-content:space-between;margin-top:1.5rem">' +
    (showBack && _wizardStep > 1
      ? '<button class="btn btn-outline" onclick="wizardBack()">← Back</button>'
      : '<div></div>') +
    '<button class="btn btn-primary" onclick="wizardNext()">Next →</button>' +
  '</div>';
}

function collectWizardData() {
  if (_wizardStep === 2) {
    _wizardData.park_name = (document.getElementById('wiz-park-name')?.value || '').trim();
    _wizardData.park_address = (document.getElementById('wiz-park-address')?.value || '').trim();
    _wizardData.park_phone = (document.getElementById('wiz-park-phone')?.value || '').trim();
    _wizardData.park_email = (document.getElementById('wiz-park-email')?.value || '').trim();
    _wizardData.park_website = (document.getElementById('wiz-park-website')?.value || '').trim();
  } else if (_wizardStep === 3) {
    _wizardData.lot_count = document.getElementById('wiz-lot-count')?.value || '';
    _wizardData.default_monthly_rate = document.getElementById('wiz-monthly-rate')?.value || '295';
    _wizardData.electric_rate = document.getElementById('wiz-electric-rate')?.value || '0.15';
  } else if (_wizardStep === 4) {
    _wizardData.admin_name = (document.getElementById('wiz-admin-name')?.value || '').trim();
    var pw = document.getElementById('wiz-password')?.value || '';
    var pwc = document.getElementById('wiz-password-confirm')?.value || '';
    _wizardData.new_password = pw;
    _wizardData._pw_confirm = pwc;
  }
}

function wizardNext() {
  collectWizardData();

  // Validation
  if (_wizardStep === 2) {
    if (!_wizardData.park_name) {
      alert('Please enter your park name.');
      document.getElementById('wiz-park-name')?.focus();
      return;
    }
  }
  if (_wizardStep === 3) {
    var c = parseInt(_wizardData.lot_count);
    if (!c || c < 1) {
      alert('Please enter how many lots your park has.');
      document.getElementById('wiz-lot-count')?.focus();
      return;
    }
  }
  if (_wizardStep === 4) {
    if (_wizardData.new_password && _wizardData.new_password.length < 6) {
      var errEl = document.getElementById('wiz-pw-error');
      if (errEl) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = ''; }
      return;
    }
    if (_wizardData.new_password && _wizardData.new_password !== _wizardData._pw_confirm) {
      var errEl = document.getElementById('wiz-pw-error');
      if (errEl) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = ''; }
      return;
    }
  }

  _wizardStep++;
  if (_wizardStep > WIZARD_STEPS) _wizardStep = WIZARD_STEPS;
  renderWizardStep();
  // Scroll wizard to top
  document.getElementById('setup-wizard')?.scrollTo(0, 0);
}

function wizardBack() {
  collectWizardData();
  _wizardStep--;
  if (_wizardStep < 1) _wizardStep = 1;
  renderWizardStep();
}

async function finishSetupWizard() {
  var btn = document.querySelector('#wizard-body .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Setting up...'; }

  try {
    await API.post('/settings/setup-wizard', {
      park_name: _wizardData.park_name,
      park_address: _wizardData.park_address,
      park_phone: _wizardData.park_phone,
      park_email: _wizardData.park_email,
      park_website: _wizardData.park_website,
      lot_count: _wizardData.lot_count,
      default_monthly_rate: _wizardData.default_monthly_rate,
      electric_rate: _wizardData.electric_rate,
      new_password: _wizardData.new_password || null,
    });

    hideSetupWizard();
    if (typeof applyBranding === 'function') applyBranding();
    navigateTo('dashboard');
    setTimeout(function() {
      if (typeof showStatusToast === 'function') showStatusToast('🎉', 'Park setup complete! Welcome aboard.');
    }, 500);
  } catch (err) {
    alert('Setup failed: ' + (err.message || 'Please try again.'));
    if (btn) { btn.disabled = false; btn.textContent = 'Take me to my dashboard →'; }
  }
}
