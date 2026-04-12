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

  // Load flat rate tenant table
  loadFlatRateTenants();
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
