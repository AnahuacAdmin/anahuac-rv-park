/*
 * Anahuac RV Park — Bank Reconciliation
 */

async function loadBankRecon() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  var year = new Date().getFullYear();
  document.getElementById('page-content').innerHTML =
    helpPanel('bank-recon') +
    '<div class="page-header"><h2>🏦 Bank Reconciliation</h2>' +
    '<div class="btn-group">' +
      '<select id="recon-year" style="padding:0.4rem 0.75rem;border-radius:6px;border:1px solid var(--gray-300)">' +
        '<option value="2026" selected>2026</option><option value="2025">2025</option>' +
      '</select>' +
    '</div></div>' +
    '<div id="recon-content">Loading...</div>';

  setTimeout(function() {
    document.getElementById('recon-year')?.addEventListener('change', function() { renderRecon(this.value); });
  }, 50);
  renderRecon(year);
}

async function renderRecon(year) {
  var el = document.getElementById('recon-content');
  if (!el) return;

  try {
    var rows = await API.get('/bank-reconciliation?year=' + year);
    var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var reconMap = {};
    (rows || []).forEach(function(r) { reconMap[r.month] = r; });

    var html = '<div class="card"><div class="table-container"><table>' +
      '<thead><tr><th>Month</th><th>Beginning Balance</th><th>Ending Balance</th><th>Change</th><th>Reconciled</th><th>Notes</th><th>Actions</th></tr></thead><tbody>';

    for (var m = 1; m <= 12; m++) {
      var r = reconMap[m] || {};
      var begin = Number(r.beginning_balance) || 0;
      var end = Number(r.ending_balance) || 0;
      var change = end - begin;
      var changeColor = change >= 0 ? '#166534' : '#dc2626';

      html += '<tr>' +
        '<td><strong>' + monthNames[m - 1] + '</strong></td>' +
        '<td><input type="number" step="0.01" value="' + begin.toFixed(2) + '" data-month="' + m + '" data-field="beginning_balance" class="recon-input" style="width:110px;text-align:right"></td>' +
        '<td><input type="number" step="0.01" value="' + end.toFixed(2) + '" data-month="' + m + '" data-field="ending_balance" class="recon-input" style="width:110px;text-align:right"></td>' +
        '<td style="font-weight:700;color:' + changeColor + '">' + (change >= 0 ? '+' : '') + formatMoney(change) + '</td>' +
        '<td style="text-align:center"><input type="checkbox" data-month="' + m + '" data-field="is_reconciled" class="recon-check"' + (r.is_reconciled ? ' checked' : '') + '></td>' +
        '<td><input type="text" value="' + escapeHtml(r.notes || '') + '" data-month="' + m + '" data-field="notes" class="recon-input" placeholder="Notes..." style="width:150px"></td>' +
        '<td><button class="btn btn-sm btn-primary" onclick="saveReconRow(' + m + ',' + year + ')">Save</button></td>' +
      '</tr>';
    }
    html += '</tbody></table></div></div>';

    html += '<div style="margin-top:1rem;padding:1rem;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:0.85rem">' +
      '<strong style="color:#92400e">💡 How to reconcile:</strong>' +
      '<ol style="margin:0.5rem 0 0;padding-left:1.25rem;color:var(--gray-600)">' +
        '<li>Enter the beginning and ending bank balance from your bank statement for each month</li>' +
        '<li>Compare the "Change" column with the P&L net profit for the same month</li>' +
        '<li>If they match (or are close), check the "Reconciled" box</li>' +
        '<li>Note any discrepancies in the Notes field</li>' +
      '</ol></div>';

    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load: ' + escapeHtml(err.message || 'Unknown') + '</div>';
  }
}

async function saveReconRow(month, year) {
  var beginEl = document.querySelector('[data-month="' + month + '"][data-field="beginning_balance"]');
  var endEl = document.querySelector('[data-month="' + month + '"][data-field="ending_balance"]');
  var reconEl = document.querySelector('[data-month="' + month + '"][data-field="is_reconciled"]');
  var notesEl = document.querySelector('[data-month="' + month + '"][data-field="notes"]');

  await API.post('/bank-reconciliation', {
    month: month,
    year: year,
    beginning_balance: parseFloat(beginEl?.value) || 0,
    ending_balance: parseFloat(endEl?.value) || 0,
    is_reconciled: reconEl?.checked ? 1 : 0,
    notes: notesEl?.value || ''
  });
  showStatusToast('✅', 'Saved');
}
