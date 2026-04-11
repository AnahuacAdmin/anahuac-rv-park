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

  document.getElementById('page-content').innerHTML = `
    <div class="page-header"><h2>Admin &amp; Backup</h2></div>

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
}

async function saveWifiPassword() {
  const val = document.getElementById('wifi-password-input')?.value || '';
  try {
    await API.put('/settings', { wifi_password: val });
    showStatusToast('✅', 'WiFi password saved!');
    const t = document.querySelector('.status-toast.visible');
    if (t) setTimeout(() => t.classList.remove('visible'), 2500);
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
