/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */

const VENDOR_CATEGORIES = [
  { value: 'Plumbing', icon: '🔧' },
  { value: 'Electrical', icon: '⚡' },
  { value: 'General Contractor', icon: '🏗️' },
  { value: 'Landscaping/Lawn', icon: '🌿' },
  { value: 'Pest Control', icon: '🐛' },
  { value: 'Waste/Septic', icon: '🗑️' },
  { value: 'Water/Utilities', icon: '💧' },
  { value: 'Supplies/Hardware', icon: '📦' },
  { value: 'Grocery/Food', icon: '🏪' },
  { value: 'Emergency Services', icon: '🚑' },
  { value: 'Medical', icon: '🏥' },
  { value: 'Legal', icon: '⚖️' },
  { value: 'Financial/Accounting', icon: '💰' },
  { value: 'Internet/Cable', icon: '🔌' },
  { value: 'Equipment Rental', icon: '🚜' },
  { value: 'Paint/Maintenance', icon: '🎨' },
  { value: 'Locksmith', icon: '🔑' },
  { value: 'Auto/Towing', icon: '🚗' },
  { value: 'Other', icon: '📋' },
];

function catIcon(category) {
  const c = VENDOR_CATEGORIES.find(x => x.value === category);
  return c ? c.icon : '📋';
}

const PARK_ADDRESS = '1003+Davis+Ave+Anahuac+TX+77514';

async function loadVendors() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  const vendors = await API.get('/vendors');
  if (!vendors) return;

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('vendors')}
    <div class="page-header">
      <h2>📒 Vendor Directory</h2>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="showAddVendor()">+ Add Vendor</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="text" id="vendor-search" placeholder="Search vendors..." oninput="filterVendors()" style="flex:1;max-width:300px">
      <select id="vendor-cat-filter" onchange="filterVendors()">
        <option value="all">All Categories</option>
        ${VENDOR_CATEGORIES.map(c => '<option value="' + c.value + '">' + c.icon + ' ' + c.value + '</option>').join('')}
      </select>
      <select id="vendor-sort" onchange="filterVendors()">
        <option value="name">Sort: Name</option>
        <option value="category">Sort: Category</option>
        <option value="favorite">Sort: Favorites First</option>
        <option value="used">Sort: Last Used</option>
      </select>
    </div>
    <div id="vendor-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:0.75rem">
      ${renderVendorCards(vendors)}
    </div>
  `;

  window._allVendors = vendors;
}

function renderVendorCards(vendors) {
  if (!vendors.length) return '<div class="card" style="text-align:center;padding:2rem;color:#78716c"><div style="font-size:2rem;margin-bottom:0.5rem">📒</div>No vendors yet. Click <strong>+ Add Vendor</strong> to get started.</div>';
  return vendors.map(v => {
    const addr = [v.address, v.city, v.state, v.zip].filter(Boolean).join(', ');
    const mapsUrl = addr ? 'https://www.google.com/maps/dir/' + PARK_ADDRESS + '/' + encodeURIComponent(addr) : '';
    return `
    <div class="card" style="padding:1rem;border-left:4px solid ${v.is_favorite ? '#f59e0b' : 'var(--gray-200)'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem">
        <div>
          <div style="font-size:1.05rem;font-weight:700;color:var(--gray-900)">${escapeHtml(v.name)}</div>
          <span class="badge badge-info" style="font-size:0.68rem">${catIcon(v.category)} ${escapeHtml(v.category || 'Other')}</span>
        </div>
        <button onclick="toggleFavorite(${v.id})" style="background:none;border:none;font-size:1.3rem;cursor:pointer;padding:0" title="${v.is_favorite ? 'Remove from favorites' : 'Add to favorites'}">${v.is_favorite ? '⭐' : '☆'}</button>
      </div>
      <div style="display:grid;gap:0.3rem;font-size:0.85rem;margin-bottom:0.5rem">
        ${v.phone ? '<div><a href="tel:' + escapeHtml(v.phone) + '" style="color:var(--brand-primary);font-weight:600;text-decoration:none">📞 ' + escapeHtml(v.phone) + '</a></div>' : ''}
        ${v.email ? '<div><a href="mailto:' + escapeHtml(v.email) + '" style="color:var(--brand-primary);text-decoration:none">📧 ' + escapeHtml(v.email) + '</a></div>' : ''}
        ${v.website ? '<div><a href="' + escapeHtml(v.website) + '" target="_blank" rel="noopener noreferrer" style="color:var(--brand-primary);text-decoration:none">🌐 Website</a></div>' : ''}
        ${addr ? '<div style="color:var(--gray-600)">📍 ' + escapeHtml(addr) + '</div>' : ''}
      </div>
      ${v.notes ? '<div style="font-size:0.8rem;color:var(--gray-500);margin-bottom:0.5rem;border-left:2px solid var(--gray-200);padding-left:0.5rem">' + escapeHtml(v.notes) + '</div>' : ''}
      ${v.last_used ? '<div style="font-size:0.72rem;color:var(--gray-400)">Last used: ' + formatDate(v.last_used) + '</div>' : ''}
      <div style="display:flex;gap:0.4rem;margin-top:0.5rem;flex-wrap:wrap">
        ${v.phone ? '<a href="tel:' + escapeHtml(v.phone) + '" class="btn btn-sm btn-success" style="font-size:0.75rem" onclick="markUsed(' + v.id + ')">📞 Call</a>' : ''}
        ${mapsUrl ? '<a href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline" style="font-size:0.75rem">📍 Directions</a>' : ''}
        <button class="btn btn-sm btn-outline" style="font-size:0.75rem" onclick="showEditVendor(${v.id})">Edit</button>
        <button class="btn btn-sm btn-danger" style="font-size:0.75rem" onclick="deleteVendor(${v.id}, '${escapeHtml(v.name).replace(/'/g, "\\'")}')">Del</button>
      </div>
    </div>`;
  }).join('');
}

function filterVendors() {
  const search = (document.getElementById('vendor-search')?.value || '').toLowerCase();
  const cat = document.getElementById('vendor-cat-filter')?.value || 'all';
  const sort = document.getElementById('vendor-sort')?.value || 'name';
  let filtered = (window._allVendors || []).filter(v => {
    if (cat !== 'all' && v.category !== cat) return false;
    if (search && !(v.name + ' ' + (v.category || '') + ' ' + (v.notes || '') + ' ' + (v.phone || '')).toLowerCase().includes(search)) return false;
    return true;
  });
  if (sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'category') filtered.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
  else if (sort === 'favorite') filtered.sort((a, b) => (b.is_favorite || 0) - (a.is_favorite || 0) || a.name.localeCompare(b.name));
  else if (sort === 'used') filtered.sort((a, b) => (b.last_used || '').localeCompare(a.last_used || ''));
  document.getElementById('vendor-list').innerHTML = renderVendorCards(filtered);
}

function vendorFormHtml(v) {
  v = v || {};
  return `
    <form onsubmit="${v.id ? 'updateVendor(event,' + v.id + ')' : 'createVendor(event)'}">
      <div class="form-group"><label>Business Name</label><input name="name" value="${escapeHtml(v.name || '')}" required></div>
      <div class="form-row">
        <div class="form-group"><label>Category</label>
          <select name="category">${VENDOR_CATEGORIES.map(c => '<option value="' + c.value + '"' + (v.category === c.value ? ' selected' : '') + '>' + c.icon + ' ' + c.value + '</option>').join('')}</select>
        </div>
        <div class="form-group"><label>Phone</label><input name="phone" value="${escapeHtml(v.phone || '')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${escapeHtml(v.email || '')}"></div>
        <div class="form-group"><label>Website</label><input name="website" value="${escapeHtml(v.website || '')}" placeholder="https://..."></div>
      </div>
      <div class="form-group"><label>Address</label><input name="address" value="${escapeHtml(v.address || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label>City</label><input name="city" value="${escapeHtml(v.city || '')}"></div>
        <div class="form-group"><label>State</label><input name="state" value="${escapeHtml(v.state || 'TX')}" maxlength="2"></div>
        <div class="form-group"><label>Zip</label><input name="zip" value="${escapeHtml(v.zip || '')}"></div>
      </div>
      <div class="form-group"><label>Notes</label><textarea name="notes">${escapeHtml(v.notes || '')}</textarea></div>
      <label style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;cursor:pointer">
        <input type="checkbox" name="is_favorite" value="1" ${v.is_favorite ? 'checked' : ''}> ⭐ Mark as Favorite
      </label>
      <button type="submit" class="btn btn-primary btn-full">${v.id ? 'Update' : 'Add'} Vendor</button>
    </form>
  `;
}

function showAddVendor() { showModal('+ Add Vendor', vendorFormHtml()); }

async function showEditVendor(id) {
  const vendors = await API.get('/vendors');
  const v = (vendors || []).find(x => x.id === id);
  if (!v) return;
  showModal('Edit Vendor', vendorFormHtml(v));
}

async function createVendor(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);
  data.is_favorite = data.is_favorite === '1' ? 1 : 0;
  await API.post('/vendors', data);
  closeModal();
  loadVendors();
}

async function updateVendor(e, id) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);
  data.is_favorite = data.is_favorite === '1' ? 1 : 0;
  await API.put('/vendors/' + id, data);
  closeModal();
  loadVendors();
}

async function deleteVendor(id, name) {
  if (!confirm('Delete vendor "' + name + '"?')) return;
  await API.del('/vendors/' + id);
  loadVendors();
}

async function toggleFavorite(id) {
  await API.post('/vendors/' + id + '/favorite', {});
  loadVendors();
}

async function markUsed(id) {
  try { await API.post('/vendors/' + id + '/used', {}); } catch {}
}
