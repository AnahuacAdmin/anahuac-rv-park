/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
async function loadAdmin() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = `
      <div class="page-header"><h2>Admin</h2></div>
      <div class="card"><p>Admin access required.</p></div>`;
    return;
  }

  const [info, settings] = await Promise.all([API.get('/admin/backup-info'), API.get('/settings')]);
  const lastBackup = info?.lastBackupAt ? new Date(info.lastBackupAt).toLocaleString() : 'Never';
  const wifiPassword = settings?.wifi_password || '';
  const electricRate = settings?.electric_rate || '0.15';
  const mgrPhone = settings?.manager_phone || '';
  const mgrEmail = settings?.manager_email || '';
  const autoEvictSms = settings?.auto_eviction_sms === '1';
  const autoEvictEmail = settings?.auto_eviction_email === '1';

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('admin')}
    <div class="page-header"><h2>Admin &amp; Backup</h2></div>

    <div class="card" style="border-left:4px solid #f59e0b">
      <h3>⚡ Electric Rate</h3>
      <p><small>Rate per kWh used for all meter reading calculations and invoices.</small></p>
      <div class="form-row mt-1">
        <div class="form-group">
          <label>Rate per kWh ($)</label>
          <input type="number" step="0.01" id="electric-rate-input" value="${electricRate}" style="font-size:1.2rem;font-weight:700;max-width:150px">
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="saveElectricRate()">Save Rate</button>
        </div>
      </div>
    </div>

    <div class="card" style="border-left:4px solid #16a34a">
      <h3>💲 Flat Rate Billing</h3>
      <p><small>Set a default flat rate for new tenants and manage bulk flat rate assignments.</small></p>
      <div class="form-row mt-1">
        <div class="form-group">
          <label>Default Flat Rate ($/month)</label>
          <input type="number" step="0.01" id="default-flat-rate-input" value="${settings?.default_flat_rate || 0}" style="font-size:1.2rem;font-weight:700;max-width:180px">
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="saveDefaultFlatRate()">Save Default</button>
        </div>
      </div>
      <div class="btn-group mt-1" style="flex-wrap:wrap">
        <button class="btn btn-success" onclick="applyFlatRateAll()">Apply to All Lots</button>
        <button class="btn btn-warning" onclick="applyFlatRateRow()">Apply to Row...</button>
        <button class="btn btn-danger" onclick="removeFlatRateAll()">Remove Flat Rate from All</button>
      </div>
      <div id="flat-rate-tenants" style="margin-top:1rem"></div>
    </div>

    <div class="card">
      <h3>WiFi Password</h3>
      <p><small>This password is included in the welcome SMS sent to new tenants on check-in.</small></p>
      <div class="form-row mt-1">
        <div class="form-group">
          <label>WiFi Password</label>
          <input type="text" id="wifi-password-input" value="${wifiPassword}">
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="saveWifiPassword()">Save</button>
        </div>
      </div>
    </div>

    <div class="card" style="border-left:4px solid #dc2626">
      <h3>🚨 Eviction Notifications</h3>
      <p><small style="color:#dc2626">When enabled, tenants will automatically receive a formal eviction notice via SMS/email when their invoice becomes 5+ days overdue.</small></p>
      <div class="form-row mt-1">
        <div class="form-group"><label>Manager Phone (for alerts)</label><input type="text" id="mgr-phone-input" value="${mgrPhone}" placeholder="+14095551234"></div>
        <div class="form-group"><label>Manager Email (for alerts)</label><input type="email" id="mgr-email-input" value="${mgrEmail}" placeholder="manager@example.com"></div>
      </div>
      <div class="form-row mt-1">
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:0.5rem"><input type="checkbox" id="auto-evict-sms" ${autoEvictSms ? 'checked' : ''}> Auto-send eviction SMS to tenant</label>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:0.5rem"><input type="checkbox" id="auto-evict-email" ${autoEvictEmail ? 'checked' : ''}> Auto-send eviction email to tenant</label>
        </div>
      </div>
      <button class="btn btn-danger mt-1" onclick="saveEvictionSettings()">Save Eviction Settings</button>
    </div>

    <div class="card" style="border-left:4px solid #0284c7">
      <h3>📱 Downtime Alert Recipients</h3>
      <p><small>When enabled, managers receive SMS alerts when services go down and recover. Checks run every 5 minutes. Max 1 alert per service per hour.</small></p>
      <div class="form-row mt-1">
        <div class="form-group">
          <label>Alert Phone Numbers (comma-separated)</label>
          <input type="text" id="alert-phones-input" value="${settings?.alert_phone_numbers || ''}" placeholder="+14092676603, +18325551234">
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:0.5rem;margin-top:1.5rem">
            <input type="checkbox" id="alerts-enabled" ${settings?.downtime_alerts_enabled === '1' ? 'checked' : ''}> Enable Downtime Alerts
          </label>
        </div>
      </div>
      <div class="btn-group mt-1">
        <button class="btn btn-primary" onclick="saveAlertSettings()">Save Alert Settings</button>
        <button class="btn btn-outline" onclick="sendTestAlert()">📲 Send Test Alert</button>
      </div>
      <div id="alert-history" style="margin-top:1rem"></div>
    </div>

    <div class="card">
      <h3>📡 Offline Mode</h3>
      <p><small>When internet is lost, check-ins, meter readings, and cash payments are saved locally on your device and auto-sync when reconnected.</small></p>
      <div id="offline-admin-status" style="margin:0.75rem 0;font-size:0.85rem;color:var(--gray-500)">Loading...</div>
      <div class="btn-group mt-1">
        <button class="btn btn-outline" onclick="viewPendingSync()">📋 View Pending Items</button>
        <button class="btn btn-primary" onclick="if(typeof syncPendingRecords==='function'){syncPendingRecords();showStatusToast('🔄','Sync triggered')}">🔄 Force Sync</button>
        <button class="btn btn-danger" onclick="clearOfflineCache()">🗑️ Clear Offline Cache</button>
      </div>
      <div style="margin-top:0.75rem">
        <a href="/emergency-form.html" target="_blank" class="btn btn-outline" style="display:inline-flex">🖨️ Print Emergency Backup Forms</a>
      </div>
    </div>

    <div class="card" style="border-left:4px solid #f59e0b">
      <h3>🍽️ Portal Restaurants</h3>
      <p><small>Manage the restaurant links shown to tenants on the portal.</small></p>
      <div id="admin-restaurants-list" style="margin:0.75rem 0">Loading...</div>
      <button class="btn btn-sm btn-primary" id="btn-add-restaurant">➕ Add Restaurant</button>
    </div>

    <div class="card">
      <h3>Database Backup</h3>
      <p>Last backup: <strong id="last-backup-display">${lastBackup}</strong></p>
      <div class="btn-group mt-2">
        <button class="btn btn-primary" onclick="downloadDatabaseBackup()">Download Backup (.sqlite)</button>
        <button class="btn btn-warning" onclick="document.getElementById('restore-input').click()">Restore from Backup</button>
        <input type="file" id="restore-input" accept=".sqlite,.db,application/octet-stream" style="display:none" onchange="restoreDatabaseBackup(this)">
      </div>
      <p class="mt-2"><small>The backup is the complete SQLite database file. Restoring will replace ALL current data — download a fresh backup first.</small></p>
    </div>

    <div class="card">
      <h3>Spreadsheet Backup</h3>
      <p>Export every table to a single Excel file with one sheet per table. Useful for keeping a human-readable copy alongside the SQLite backup.</p>
      <button class="btn btn-success mt-1" onclick="exportAllDataToExcel()">Export All Data to Excel</button>
    </div>
  `;

  // Load dynamic sections
  loadFlatRateTenants();
  loadAlertHistory();
  loadOfflineAdminStatus();
  loadAdminRestaurants();
  // Wire add restaurant button
  setTimeout(function() {
    var btn = document.getElementById('btn-add-restaurant');
    if (btn) btn.addEventListener('click', showAddRestaurant);
  }, 50);
}

async function saveEvictionSettings() {
  try {
    await API.put('/settings', {
      manager_phone: document.getElementById('mgr-phone-input')?.value || '',
      manager_email: document.getElementById('mgr-email-input')?.value || '',
      auto_eviction_sms: document.getElementById('auto-evict-sms')?.checked ? '1' : '0',
      auto_eviction_email: document.getElementById('auto-evict-email')?.checked ? '1' : '0',
    });
    showStatusToast('✅', 'Eviction settings saved!');
  } catch (err) { alert('Failed to save: ' + (err.message || 'unknown')); }
}

async function saveElectricRate() {
  const val = document.getElementById('electric-rate-input')?.value || '0.15';
  try {
    await API.put('/settings', { electric_rate: val });
    showStatusToast('✅', `Electric rate saved: $${val}/kWh`);
  } catch (err) {
    alert('Failed to save: ' + (err.message || 'unknown'));
  }
}

async function saveWifiPassword() {
  const val = document.getElementById('wifi-password-input')?.value || '';
  try {
    await API.put('/settings', { wifi_password: val });
    showStatusToast('✅', 'WiFi password saved!');
  } catch (err) {
    alert('Failed to save: ' + (err.message || 'unknown'));
  }
}

async function downloadDatabaseBackup() {
  try {
    const res = await fetch('/api/admin/backup', {
      headers: { 'Authorization': `Bearer ${API.token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Backup failed (${res.status})`);
    }
    const blob = await res.blob();
    const today = new Date().toISOString().split('T')[0];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rvpark-backup-${today}.sqlite`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    // Refresh the last-backup display
    const info = await API.get('/admin/backup-info');
    const el = document.getElementById('last-backup-display');
    if (el && info?.lastBackupAt) el.textContent = new Date(info.lastBackupAt).toLocaleString();
  } catch (err) {
    alert('Backup failed: ' + (err.message || 'unknown error'));
  }
}

async function restoreDatabaseBackup(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!confirm(`Restore the database from "${file.name}"?\n\nThis will OVERWRITE all current data with the contents of the backup file. Make sure you have a fresh backup first.`)) {
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const res = await fetch('/api/admin/restore', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API.token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: buf,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Restore failed (${res.status})`);
    alert(`Database restored from backup (${(data.sizeBytes / 1024).toFixed(1)} KB).\n\nReloading the app to pick up the new data...`);
    location.reload();
  } catch (err) {
    alert('Restore failed: ' + (err.message || 'unknown error'));
  }
}

async function saveDefaultFlatRate() {
  const val = document.getElementById('default-flat-rate-input')?.value || '0';
  try {
    await API.put('/settings', { default_flat_rate: val });
    showStatusToast('✅', `Default flat rate saved: $${val}/month`);
  } catch (err) { alert('Failed to save: ' + (err.message || 'unknown')); }
}

async function applyFlatRateAll() {
  const amount = parseFloat(document.getElementById('default-flat-rate-input')?.value);
  if (!amount || amount <= 0) { alert('Enter a default flat rate amount first.'); return; }
  if (!confirm(`Set ALL active tenants to flat rate billing at $${amount.toFixed(2)}/month?\n\nThis will override their current billing settings.`)) return;
  try {
    const r = await API.post('/tenants/bulk-flat-rate', { action: 'apply_all', amount });
    showStatusToast('✅', `Flat rate applied to ${r.updated} tenants`);
    loadFlatRateTenants();
  } catch (err) { alert('Failed: ' + (err.message || 'unknown')); }
}

async function applyFlatRateRow() {
  const amount = parseFloat(document.getElementById('default-flat-rate-input')?.value);
  if (!amount || amount <= 0) { alert('Enter a default flat rate amount first.'); return; }
  const row = prompt('Enter row letter (e.g. A, B, C):');
  if (!row) return;
  const letter = row.trim().toUpperCase();
  if (!/^[A-Z]$/.test(letter)) { alert('Please enter a single letter A-Z.'); return; }
  if (!confirm(`Apply flat rate of $${amount.toFixed(2)}/month to all tenants in Row ${letter}?`)) return;
  try {
    const r = await API.post('/tenants/bulk-flat-rate', { action: 'apply_row', amount, row_letter: letter });
    showStatusToast('✅', `Flat rate applied to ${r.updated} tenants in Row ${letter}`);
    loadFlatRateTenants();
  } catch (err) { alert('Failed: ' + (err.message || 'unknown')); }
}

async function removeFlatRateAll() {
  if (!confirm('Remove flat rate from ALL tenants?\n\nThey will go back to individual billing (rent + electric).')) return;
  try {
    const r = await API.post('/tenants/bulk-flat-rate', { action: 'remove_all' });
    showStatusToast('✅', `Flat rate removed from ${r.updated} tenants`);
    loadFlatRateTenants();
  } catch (err) { alert('Failed: ' + (err.message || 'unknown')); }
}

async function loadFlatRateTenants() {
  const el = document.getElementById('flat-rate-tenants');
  if (!el) return;
  try {
    const tenants = await API.get('/tenants');
    const flat = (tenants || []).filter(t => t.flat_rate);
    if (!flat.length) {
      el.innerHTML = '<p style="color:#78716c;font-size:0.85rem">No tenants currently on flat rate billing.</p>';
      return;
    }
    el.innerHTML = `
      <table style="width:100%;font-size:0.85rem">
        <thead><tr><th>Lot</th><th>Tenant</th><th>Flat Rate</th><th>Actions</th></tr></thead>
        <tbody>${flat.map(t => `
          <tr>
            <td><strong>${t.lot_id}</strong></td>
            <td>${t.first_name} ${t.last_name}</td>
            <td>${formatMoney(t.flat_rate_amount)}/mo</td>
            <td><button class="btn btn-sm btn-outline" onclick="showEditTenant(${t.id})">Edit</button></td>
          </tr>
        `).join('')}</tbody>
      </table>
      <p style="font-size:0.78rem;color:#78716c;margin-top:0.5rem">${flat.length} tenant${flat.length > 1 ? 's' : ''} on flat rate — Total: ${formatMoney(flat.reduce((s, t) => s + (Number(t.flat_rate_amount) || 0), 0))}/month</p>
    `;
  } catch { el.innerHTML = ''; }
}

async function viewPendingSync() {
  if (typeof getAllPending !== 'function') { alert('Offline engine not loaded.'); return; }
  const pending = await getAllPending();
  if (!pending.length) { showModal('Pending Sync Items', '<p style="text-align:center;color:#78716c;padding:1rem">No items waiting to sync.</p>'); return; }
  showModal('Pending Sync Items', `
    <table><thead><tr><th>Type</th><th>Created</th><th>Data Preview</th></tr></thead>
    <tbody>${pending.map(p => `<tr><td><span class="badge badge-warning">${p.type}</span></td><td style="font-size:0.78rem">${p.createdAt || '—'}</td><td style="font-size:0.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${JSON.stringify(p.data).slice(0, 80)}</td></tr>`).join('')}</tbody>
    </table>
    <p class="mt-2" style="font-size:0.82rem;color:#78716c">${pending.length} item${pending.length > 1 ? 's' : ''} waiting to sync. They will auto-sync when online.</p>
  `);
}

async function clearOfflineCache() {
  if (!confirm('Clear ALL offline cached data and pending items? This cannot be undone.')) return;
  if (typeof clearAllPending === 'function') await clearAllPending();
  try {
    const db = await openOfflineDb();
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').clear();
  } catch {}
  showStatusToast('✅', 'Offline cache cleared');
  loadOfflineAdminStatus();
}

async function loadOfflineAdminStatus() {
  const el = document.getElementById('offline-admin-status');
  if (!el) return;
  try {
    const pending = typeof getAllPending === 'function' ? await getAllPending() : [];
    const cached = typeof getCachedTenants === 'function' ? await getCachedTenants() : null;
    el.innerHTML = `
      <div>Status: <strong>${navigator.onLine ? '🟢 Online' : '🔴 Offline'}</strong></div>
      <div>Pending sync: <strong>${pending.length}</strong> item${pending.length !== 1 ? 's' : ''}</div>
      ${cached ? `<div>Tenant cache: <strong>${cached.data?.length || 0} tenants</strong> (cached ${new Date(cached.cachedAt).toLocaleString()})</div>` : '<div>Tenant cache: not yet cached</div>'}
    `;
  } catch { el.textContent = 'Offline engine not available.'; }
}

async function saveAlertSettings() {
  try {
    await API.put('/settings', {
      alert_phone_numbers: document.getElementById('alert-phones-input')?.value || '',
      downtime_alerts_enabled: document.getElementById('alerts-enabled')?.checked ? '1' : '0',
    });
    showStatusToast('✅', 'Alert settings saved!');
  } catch (err) { alert('Failed to save: ' + (err.message || 'unknown')); }
}

async function sendTestAlert() {
  try {
    const r = await API.post('/health/test-alert', {});
    showStatusToast('✅', `Test alert sent to ${r.sent}/${r.total} numbers`);
  } catch (err) { alert('Test failed: ' + (err.message || 'unknown')); }
}

async function loadAlertHistory() {
  const el = document.getElementById('alert-history');
  if (!el) return;
  try {
    const alerts = await API.get('/health/alerts');
    if (!alerts?.length) { el.innerHTML = '<p style="font-size:0.82rem;color:#78716c">No alerts yet. Alerts appear here when services go down.</p>'; return; }
    el.innerHTML = `
      <div style="font-size:0.8rem;font-weight:600;color:#44403c;margin-bottom:0.4rem">Recent Alerts</div>
      ${alerts.slice(0, 5).map(a => `
        <div style="display:flex;gap:0.5rem;align-items:flex-start;padding:0.35rem 0;border-bottom:1px solid var(--gray-200);font-size:0.82rem">
          <span>${a.resolved_at ? '✅' : '🔴'}</span>
          <div style="flex:1">
            <strong>${a.service}</strong> — ${a.message || ''}
            <div style="font-size:0.7rem;color:#a8a29e">${a.alerted_at}${a.resolved_at ? ' → Resolved ' + a.resolved_at : ' — ACTIVE'}</div>
          </div>
        </div>
      `).join('')}
    `;
  } catch { el.innerHTML = ''; }
}

async function exportAllDataToExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Excel library failed to load. Check your internet connection and try again.');
    return;
  }
  try {
    const [tenants, lots, meters, payments, invoices] = await Promise.all([
      API.get('/tenants/all'),
      API.get('/lots'),
      API.get('/meters'),
      API.get('/payments'),
      API.get('/invoices'),
    ]);

    const wb = XLSX.utils.book_new();
    const addSheet = (name, rows) => {
      const ws = XLSX.utils.json_to_sheet(rows && rows.length ? rows : [{ note: 'No data' }]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    addSheet('Tenants',  tenants  || []);
    addSheet('Lots',     lots     || []);
    addSheet('Meters',   meters   || []);
    addSheet('Payments', payments || []);
    addSheet('Invoices', invoices || []);

    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Anahuac-FullExport-${today}.xlsx`);
  } catch (err) {
    alert('Export failed: ' + (err.message || 'unknown error'));
  }
}

// --- Portal Restaurants Admin ---
async function loadAdminRestaurants() {
  var el = document.getElementById('admin-restaurants-list');
  if (!el) return;
  try {
    var list = await API.get('/settings/restaurants');
    if (!list || !list.length) { el.innerHTML = '<p style="font-size:0.82rem;color:#78716c">No restaurants. Click Add to create one.</p>'; return; }
    el.innerHTML = '<table style="width:100%;font-size:0.85rem"><thead><tr><th>Emoji</th><th>Name</th><th>URL</th><th>Active</th><th>Actions</th></tr></thead><tbody>' +
      list.map(function(r) {
        return '<tr>' +
          '<td>' + (r.emoji || '🍽️') + '</td>' +
          '<td><strong>' + escapeHtml(r.name) + '</strong></td>' +
          '<td style="font-size:0.75rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(r.url || '—') + '</td>' +
          '<td>' + (r.is_active ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-gray">No</span>') + '</td>' +
          '<td class="btn-group"><button class="btn btn-sm btn-outline" onclick="showEditRestaurant(' + r.id + ')">Edit</button><button class="btn btn-sm btn-danger" onclick="deleteRestaurant(' + r.id + ',\'' + escapeHtml(r.name).replace(/'/g, "\\'") + '\')">Del</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  } catch { el.innerHTML = '<p style="color:#dc2626;font-size:0.82rem">Failed to load restaurants</p>'; }
}

function showAddRestaurant() {
  showModal('➕ Add Restaurant', restaurantFormHtml());
  setTimeout(function() {
    var form = document.getElementById('restaurant-form');
    if (form) form.addEventListener('submit', function(e) { saveRestaurant(e, null); });
  }, 50);
}

async function showEditRestaurant(id) {
  var list = await API.get('/settings/restaurants');
  var r = (list || []).find(function(x) { return x.id === id; });
  if (!r) return;
  showModal('Edit Restaurant', restaurantFormHtml(r));
  setTimeout(function() {
    var form = document.getElementById('restaurant-form');
    if (form) form.addEventListener('submit', function(e) { saveRestaurant(e, id); });
  }, 50);
}

function restaurantFormHtml(r) {
  r = r || {};
  return '<form id="restaurant-form">' +
    '<div class="form-row">' +
      '<div class="form-group"><label>Emoji</label><input name="emoji" value="' + escapeHtml(r.emoji || '🍽️') + '" maxlength="4" style="font-size:1.5rem;text-align:center;width:60px"></div>' +
      '<div class="form-group"><label>Restaurant Name</label><input name="name" value="' + escapeHtml(r.name || '') + '" required></div>' +
    '</div>' +
    '<div class="form-group"><label>URL (Google Maps or website)</label><input name="url" value="' + escapeHtml(r.url || '') + '" placeholder="https://..."></div>' +
    '<label style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem"><input type="checkbox" name="is_active" value="1" ' + (r.is_active !== 0 ? 'checked' : '') + '> Active (visible on portal)</label>' +
    '<button type="submit" class="btn btn-primary btn-full">' + (r.id ? 'Update' : 'Add') + ' Restaurant</button>' +
  '</form>';
}

async function saveRestaurant(e, id) {
  e.preventDefault();
  var form = new FormData(e.target);
  var data = { name: form.get('name'), emoji: form.get('emoji'), url: form.get('url'), is_active: form.get('is_active') === '1' ? 1 : 0 };
  if (id) await API.put('/settings/restaurants/' + id, data);
  else await API.post('/settings/restaurants', data);
  closeModal();
  loadAdminRestaurants();
}

async function deleteRestaurant(id, name) {
  if (!confirm('Delete "' + name + '" from portal?')) return;
  await API.del('/settings/restaurants/' + id);
  loadAdminRestaurants();
}
