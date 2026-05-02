/*
 * Anahuac RV Park — Vendor Directory with Credential Management
 */

const VENDOR_CATEGORIES = [
  { value: 'Electricity', icon: '⚡' },
  { value: 'Water/Utilities', icon: '💧' },
  { value: 'Internet/Cable', icon: '🔌' },
  { value: 'Waste/Septic', icon: '🗑️' },
  { value: 'Insurance', icon: '🛡️' },
  { value: 'Pest Control', icon: '🐛' },
  { value: 'Security', icon: '🔒' },
  { value: 'Landscaping/Lawn', icon: '🌿' },
  { value: 'Plumbing', icon: '🔧' },
  { value: 'Electrical', icon: '⚡' },
  { value: 'General Contractor', icon: '🏗️' },
  { value: 'Supplies/Hardware', icon: '📦' },
  { value: 'Financial/Accounting', icon: '💰' },
  { value: 'Legal', icon: '⚖️' },
  { value: 'Advertising', icon: '📢' },
  { value: 'Fuel', icon: '⛽' },
  { value: 'Equipment Rental', icon: '🚜' },
  { value: 'Emergency Services', icon: '🚑' },
  { value: 'Telecom', icon: '📞' },
  { value: 'Professional Service', icon: '💼' },
  { value: 'Other', icon: '📋' },
];

function catIcon(category) {
  var c = VENDOR_CATEGORIES.find(function(x) { return x.value === category; });
  return c ? c.icon : '📋';
}

var PARK_ADDRESS = '1003+Davis+Ave+Anahuac+TX+77514';

async function loadVendors() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  var vendors = await API.get('/vendors');
  if (!vendors) return;

  document.getElementById('page-content').innerHTML =
    helpPanel('vendors') +
    '<div class="page-header"><h2>🏪 Vendor Directory</h2>' +
    '<div class="btn-group">' +
      '<button class="btn btn-primary" id="btn-add-vendor">+ Add Vendor</button>' +
    '</div></div>' +

    '<div class="filter-bar">' +
      '<input type="text" id="vendor-search" placeholder="Search vendors..." style="flex:1;max-width:300px">' +
      '<select id="vendor-cat-filter"><option value="all">All Categories</option>' +
        VENDOR_CATEGORIES.map(function(c) { return '<option value="' + c.value + '">' + c.icon + ' ' + c.value + '</option>'; }).join('') +
      '</select>' +
      '<select id="vendor-sort">' +
        '<option value="name">Sort: Name</option><option value="category">Sort: Category</option>' +
        '<option value="favorite">Sort: Favorites</option><option value="used">Sort: Last Used</option>' +
      '</select>' +
    '</div>' +
    '<div id="vendor-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:0.75rem">' +
      renderVendorCards(vendors) +
    '</div>';

  window._allVendors = vendors;
  setTimeout(function() {
    var addBtn = document.getElementById('btn-add-vendor');
    if (addBtn) addBtn.addEventListener('click', showAddVendor);
    var searchEl = document.getElementById('vendor-search');
    if (searchEl) searchEl.addEventListener('input', filterVendors);
    var catEl = document.getElementById('vendor-cat-filter');
    if (catEl) catEl.addEventListener('change', filterVendors);
    var sortEl = document.getElementById('vendor-sort');
    if (sortEl) sortEl.addEventListener('change', filterVendors);
  }, 50);
}

function renderVendorCards(vendors) {
  if (!vendors.length) return '<div class="card" style="text-align:center;padding:2rem;color:#78716c"><div style="font-size:2rem;margin-bottom:0.5rem">🏪</div>No vendors yet. Click <strong>+ Add Vendor</strong> to get started.</div>';
  return vendors.map(function(v) {
    var addr = [v.address, v.city, v.state, v.zip].filter(Boolean).join(', ');
    var mapsUrl = addr ? 'https://www.google.com/maps/dir/' + PARK_ADDRESS + '/' + encodeURIComponent(addr) : '';
    var autopayBadge = v.autopay_enrolled ? '<span class="badge badge-success" style="font-size:0.6rem;margin-left:0.25rem">AUTOPAY</span>' : '';
    var credBadge = v.has_credentials ? '<span class="badge badge-info" style="font-size:0.6rem;margin-left:0.25rem">🔑 LOGIN</span>' : '';

    return '<div class="card" style="padding:1rem;border-left:4px solid ' + (v.is_favorite ? '#f59e0b' : 'var(--gray-200)') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem">' +
        '<div>' +
          '<div style="font-size:1.05rem;font-weight:700;color:var(--gray-900)">' + escapeHtml(v.name) + '</div>' +
          '<div>' +
            '<span class="badge badge-info" style="font-size:0.68rem">' + catIcon(v.category) + ' ' + escapeHtml(v.category || 'Other') + '</span>' +
            autopayBadge + credBadge +
          '</div>' +
        '</div>' +
        '<button onclick="toggleFavorite(' + v.id + ')" style="background:none;border:none;font-size:1.3rem;cursor:pointer;padding:0">' + (v.is_favorite ? '⭐' : '☆') + '</button>' +
      '</div>' +

      '<div style="display:grid;gap:0.25rem;font-size:0.85rem;margin-bottom:0.5rem">' +
        (v.phone ? '<div><a href="tel:' + escapeHtml(v.phone) + '" style="color:var(--brand-primary);font-weight:600;text-decoration:none">📞 ' + escapeHtml(v.phone) + '</a></div>' : '') +
        (v.email ? '<div><a href="mailto:' + escapeHtml(v.email) + '" style="color:var(--brand-primary);text-decoration:none">📧 ' + escapeHtml(v.email) + '</a></div>' : '') +
        (v.website ? '<div><a href="' + (v.website.match(/^https?:\/\//) ? '' : 'https://') + escapeHtml(v.website) + '" target="_blank" rel="noopener noreferrer" style="color:var(--brand-primary);text-decoration:none">🌐 Website</a></div>' : '') +
        (v.account_number ? '<div style="font-size:0.8rem;color:var(--gray-500)">Acct: ' + escapeHtml(v.account_number) + '</div>' : '') +
        (v.payment_method ? '<div style="font-size:0.8rem;color:var(--gray-500)">Pays via: ' + escapeHtml(v.payment_method) + '</div>' : '') +
        (addr ? '<div style="color:var(--gray-600)">📍 ' + escapeHtml(addr) + '</div>' : '') +
      '</div>' +
      (v.notes ? '<div style="font-size:0.8rem;color:var(--gray-500);margin-bottom:0.5rem;border-left:2px solid var(--gray-200);padding-left:0.5rem">' + escapeHtml(v.notes) + '</div>' : '') +
      (v.last_used ? '<div style="font-size:0.72rem;color:var(--gray-400)">Last payment: ' + formatDate(v.last_used) + '</div>' : '') +

      // Quick Actions
      '<div style="display:flex;gap:0.35rem;margin-top:0.5rem;flex-wrap:wrap">' +
        (v.phone ? '<a href="tel:' + escapeHtml(v.phone) + '" class="btn btn-sm btn-success" style="font-size:0.72rem" onclick="markUsed(' + v.id + ')">📞 Call</a>' : '') +
        (v.email ? '<a href="mailto:' + escapeHtml(v.email) + '" class="btn btn-sm btn-outline" style="font-size:0.72rem">📧 Email</a>' : '') +
        (v.website || v.login_url ? '<button class="btn btn-sm btn-outline" style="font-size:0.72rem" onclick="vendorPayNow(' + v.id + ')">💳 Pay Now</button>' : '') +
        (v.has_credentials ? '<button class="btn btn-sm btn-outline" style="font-size:0.72rem;color:#7c3aed;border-color:#7c3aed" onclick="showVendorCredentials(' + v.id + ')">🔑 Login</button>' : '') +
        '<button class="btn btn-sm btn-outline" style="font-size:0.72rem" onclick="showVendorPayments(' + v.id + ',\'' + escapeHtml(v.name).replace(/'/g, "\\'") + '\')">📋 History</button>' +
        (mapsUrl ? '<a href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline" style="font-size:0.72rem">📍 Directions</a>' : '') +
        '<button class="btn btn-sm btn-outline" style="font-size:0.72rem" onclick="showEditVendor(' + v.id + ')">Edit</button>' +
        '<button class="btn btn-sm btn-danger" style="font-size:0.72rem" onclick="deleteVendor(' + v.id + ',\'' + escapeHtml(v.name).replace(/'/g, "\\'") + '\')">Del</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function filterVendors() {
  var search = (document.getElementById('vendor-search')?.value || '').toLowerCase();
  var cat = document.getElementById('vendor-cat-filter')?.value || 'all';
  var sort = document.getElementById('vendor-sort')?.value || 'name';
  var filtered = (window._allVendors || []).filter(function(v) {
    if (cat !== 'all' && v.category !== cat) return false;
    if (search && !(v.name + ' ' + (v.category || '') + ' ' + (v.notes || '') + ' ' + (v.phone || '') + ' ' + (v.account_number || '')).toLowerCase().includes(search)) return false;
    return true;
  });
  if (sort === 'name') filtered.sort(function(a, b) { return a.name.localeCompare(b.name); });
  else if (sort === 'category') filtered.sort(function(a, b) { return (a.category || '').localeCompare(b.category || ''); });
  else if (sort === 'favorite') filtered.sort(function(a, b) { return (b.is_favorite || 0) - (a.is_favorite || 0) || a.name.localeCompare(b.name); });
  else if (sort === 'used') filtered.sort(function(a, b) { return (b.last_used || '').localeCompare(a.last_used || ''); });
  document.getElementById('vendor-list').innerHTML = renderVendorCards(filtered);
}

function vendorFormHtml(v) {
  v = v || {};
  var catOpts = VENDOR_CATEGORIES.map(function(c) {
    return '<option value="' + c.value + '"' + (v.category === c.value ? ' selected' : '') + '>' + c.icon + ' ' + c.value + '</option>';
  }).join('');

  return '<form id="vendor-form" data-vendor-id="' + (v.id || '') + '">' +
    '<div class="form-group"><label>Business Name *</label><input name="name" value="' + escapeHtml(v.name || '') + '" required></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>Category</label><select name="category">' + catOpts + '</select></div>' +
      '<div class="form-group"><label>Phone</label><input name="phone" value="' + escapeHtml(v.phone || '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>Email</label><input name="email" type="email" value="' + escapeHtml(v.email || '') + '"></div>' +
      '<div class="form-group"><label>Website</label><input name="website" value="' + escapeHtml(v.website || '') + '" placeholder="https://..."></div>' +
    '</div>' +
    '<div class="form-group"><label>Address</label><input name="address" value="' + escapeHtml(v.address || '') + '"></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>City</label><input name="city" value="' + escapeHtml(v.city || '') + '"></div>' +
      '<div class="form-group"><label>State</label><input name="state" value="' + escapeHtml(v.state || 'TX') + '" maxlength="2"></div>' +
      '<div class="form-group"><label>Zip</label><input name="zip" value="' + escapeHtml(v.zip || '') + '"></div>' +
    '</div>' +

    // Account & Login section
    '<div style="border-top:1px solid var(--gray-200);margin:1rem 0 0.75rem;padding-top:0.75rem">' +
      '<div style="font-weight:700;font-size:0.88rem;color:var(--gray-700);margin-bottom:0.5rem">🔐 Account & Login Info</div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>Account Number</label><input name="account_number" value="' + escapeHtml(v.account_number || '') + '"></div>' +
      '<div class="form-group"><label>Payment Method</label><select name="payment_method">' +
        ['','Cash','Check','Credit Card','Debit Card','ACH/Bank Transfer','Zelle','Autopay','Online Portal'].map(function(m) {
          return '<option value="' + m + '"' + (v.payment_method === m ? ' selected' : '') + '>' + (m || '— Select —') + '</option>';
        }).join('') +
      '</select></div>' +
    '</div>' +
    '<div class="form-group"><label>Login URL</label><input name="login_url" value="' + escapeHtml(v.login_url || '') + '" placeholder="https://portal.vendor.com/login"></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label>Username</label><input name="username" value="' + escapeHtml(v.username || '') + '" autocomplete="off"></div>' +
      '<div class="form-group"><label>Password ' + (v.id && v.has_password ? '<span style="color:#16a34a;font-size:0.75rem">(saved — leave blank to keep)</span>' : '') + '</label>' +
        '<div style="position:relative"><input name="password" type="password" autocomplete="new-password" placeholder="' + (v.id && v.has_password ? '••••••••' : 'Enter password') + '">' +
        '<button type="button" onclick="this.previousElementSibling.type=this.previousElementSibling.type===\'password\'?\'text\':\'password\';this.textContent=this.previousElementSibling.type===\'password\'?\'👁️\':\'🙈\'" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1.1rem">👁️</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="form-group"><label>Notes</label><textarea name="notes">' + escapeHtml(v.notes || '') + '</textarea></div>' +
    '<div style="display:flex;gap:1rem;margin-bottom:1rem">' +
      '<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer"><input type="checkbox" name="is_favorite" value="1" ' + (v.is_favorite ? 'checked' : '') + '> ⭐ Favorite</label>' +
      '<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer"><input type="checkbox" name="autopay_enrolled" value="1" ' + (v.autopay_enrolled ? 'checked' : '') + '> 🔄 Autopay Enrolled</label>' +
    '</div>' +
    '<button type="submit" class="btn btn-primary btn-full">' + (v.id ? 'Update' : 'Add') + ' Vendor</button>' +
  '</form>';
}

function showAddVendor() {
  showModal('+ Add Vendor', vendorFormHtml());
  setTimeout(function() {
    var form = document.getElementById('vendor-form');
    if (form) form.addEventListener('submit', function(e) { createVendor(e); });
  }, 50);
}

async function showEditVendor(id) {
  var vendors = await API.get('/vendors');
  var v = (vendors || []).find(function(x) { return x.id === id; });
  if (!v) return;
  showModal('Edit Vendor', vendorFormHtml(v));
  setTimeout(function() {
    var form = document.getElementById('vendor-form');
    if (form) form.addEventListener('submit', function(e) { updateVendor(e, id); });
  }, 50);
}

async function createVendor(e) {
  e.preventDefault();
  var form = new FormData(e.target);
  var data = Object.fromEntries(form);
  data.is_favorite = data.is_favorite === '1' ? 1 : 0;
  data.autopay_enrolled = data.autopay_enrolled === '1' ? 1 : 0;
  if (!data.password) delete data.password;
  await API.post('/vendors', data);
  closeModal();
  showStatusToast('✅', 'Vendor added');
  loadVendors();
}

async function updateVendor(e, id) {
  e.preventDefault();
  var form = new FormData(e.target);
  var data = Object.fromEntries(form);
  data.is_favorite = data.is_favorite === '1' ? 1 : 0;
  data.autopay_enrolled = data.autopay_enrolled === '1' ? 1 : 0;
  if (!data.password) delete data.password;
  await API.put('/vendors/' + id, data);
  closeModal();
  showStatusToast('✅', 'Vendor updated');
  loadVendors();
}

async function deleteVendor(id, name) {
  if (!confirm('Delete vendor "' + name + '"?')) return;
  await API.del('/vendors/' + id);
  showStatusToast('✅', 'Vendor deleted');
  loadVendors();
}

async function toggleFavorite(id) {
  await API.post('/vendors/' + id + '/favorite', {});
  loadVendors();
}

async function markUsed(id) {
  try { await API.post('/vendors/' + id + '/used', {}); } catch {}
}

// Show decrypted credentials in a secure modal
async function showVendorCredentials(id) {
  try {
    var creds = await API.get('/vendors/' + id + '/credentials');
    showModal('🔑 Login Credentials',
      '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:1rem;margin-bottom:1rem">' +
        '<div style="font-size:0.78rem;color:#92400e;font-weight:600;margin-bottom:0.5rem">⚠️ Sensitive — do not share</div>' +
      '</div>' +
      (creds.account_number ? '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Account Number</label><div style="font-weight:700;font-size:1rem">' + escapeHtml(creds.account_number) + '</div></div>' : '') +
      (creds.username ? '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Username</label><div style="font-weight:700;font-size:1rem;user-select:all">' + escapeHtml(creds.username) + '</div></div>' : '') +
      '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Password</label>' +
        '<div style="display:flex;align-items:center;gap:0.5rem">' +
          '<span id="cred-pass-display" style="font-weight:700;font-size:1rem;font-family:monospace;user-select:all">' + (creds.password ? '••••••••' : '(not set)') + '</span>' +
          (creds.password ? '<button class="btn btn-sm btn-outline" onclick="var el=document.getElementById(\'cred-pass-display\');if(el.textContent===\'••••••••\'){el.textContent=\'' + escapeHtml(creds.password).replace(/'/g, "\\'") + '\';this.textContent=\'🙈 Hide\'}else{el.textContent=\'••••••••\';this.textContent=\'👁️ Show\'}">👁️ Show</button>' : '') +
        '</div>' +
      '</div>' +
      (creds.login_url ? '<a href="' + escapeHtml(creds.login_url) + '" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-full" style="margin-top:0.5rem">🌐 Go to Login Page</a>' : '')
    );
  } catch (err) {
    alert('Could not load credentials: ' + (err.message || 'Unknown error'));
  }
}

// Open vendor website/login URL for payment
async function vendorPayNow(id) {
  try {
    var creds = await API.get('/vendors/' + id + '/credentials');
    var url = creds.login_url || (window._allVendors || []).find(function(v) { return v.id === id; })?.website;
    if (url) {
      if (!url.match(/^https?:\/\//)) url = 'https://' + url;
      window.open(url, '_blank');
    }
    // Show credentials in a toast if available
    if (creds.username) {
      showStatusToast('🔑', 'Username: ' + creds.username);
    }
    markUsed(id);
  } catch {
    var vendor = (window._allVendors || []).find(function(v) { return v.id === id; });
    var w = vendor?.login_url || vendor?.website;
    if (w) {
      if (!w.match(/^https?:\/\//)) w = 'https://' + w;
      window.open(w, '_blank');
    }
  }
}

// Show payment history for a vendor
async function showVendorPayments(id, name) {
  try {
    var data = await API.get('/vendors/' + id + '/payments');
    var html = '<div style="margin-bottom:1rem;display:flex;gap:1rem;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:100px;text-align:center;padding:0.75rem;background:#f5f5f4;border-radius:8px"><div style="font-size:1.2rem;font-weight:800">' + (data.count || 0) + '</div><div style="font-size:0.72rem;color:var(--gray-500)">Payments</div></div>' +
      '<div style="flex:1;min-width:100px;text-align:center;padding:0.75rem;background:#f5f5f4;border-radius:8px"><div style="font-size:1.2rem;font-weight:800">' + formatMoney(data.total || 0) + '</div><div style="font-size:0.72rem;color:var(--gray-500)">Total Paid</div></div>' +
      '<div style="flex:1;min-width:100px;text-align:center;padding:0.75rem;background:#f5f5f4;border-radius:8px"><div style="font-size:1.2rem;font-weight:800">' + formatMoney(data.average || 0) + '</div><div style="font-size:0.72rem;color:var(--gray-500)">Avg Payment</div></div>' +
    '</div>';

    if (data.payments && data.payments.length) {
      html += '<div class="table-container"><table><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Description</th><th>Status</th></tr></thead><tbody>';
      data.payments.forEach(function(p) {
        html += '<tr><td>' + formatDate(p.expense_date) + '</td><td>' + escapeHtml(p.category || '') + '</td><td><strong>' + formatMoney(p.amount) + '</strong></td><td>' + escapeHtml(p.description || '') + '</td><td>' + (p.status === 'filed' ? '<span class="badge badge-success">Filed</span>' : '<span class="badge badge-warning">Pending</span>') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<p style="text-align:center;color:#78716c">No payment records for this vendor</p>';
    }
    showModal('📋 Payment History — ' + name, html);
  } catch (err) {
    alert('Could not load payment history: ' + (err.message || 'Unknown error'));
  }
}
