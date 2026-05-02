/*
 * Anahuac RV Park — Profit & Loss Report (IRS-Ready)
 */

async function loadPnl() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  var year = new Date().getFullYear();
  document.getElementById('page-content').innerHTML =
    helpPanel('pnl') +
    '<div class="page-header"><h2>📊 Profit & Loss Report</h2>' +
    '<div class="btn-group">' +
      '<select id="pnl-year" style="padding:0.4rem 0.75rem;border-radius:6px;border:1px solid var(--gray-300)">' +
        '<option value="2026" selected>2026</option><option value="2025">2025</option>' +
      '</select>' +
      '<button class="btn btn-outline" id="btn-pnl-csv">📥 Export CSV</button>' +
      '<button class="btn btn-outline" id="btn-pnl-print" onclick="window.print()">🖨️ Print</button>' +
    '</div></div>' +
    '<div id="pnl-content">Loading...</div>';

  setTimeout(function() {
    document.getElementById('pnl-year')?.addEventListener('change', function() { renderPnl(this.value); });
    document.getElementById('btn-pnl-csv')?.addEventListener('click', exportPnlCSV);
  }, 50);
  renderPnl(year);
}

async function renderPnl(year) {
  var el = document.getElementById('pnl-content');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:2rem"><div class="loading-spinner"></div> Loading P&L data...</div>';

  try {
    var data = await API.get('/pnl?year=' + year);
    if (!data || !data.months) { el.innerHTML = '<div class="card">No data available</div>'; return; }

    var monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    var curMonth = new Date().getMonth(); // 0-based

    // Build table
    var html = '<div class="card" style="overflow-x:auto;padding:0">' +
      '<div style="padding:1rem 1rem 0.5rem;background:linear-gradient(135deg,#0f3d22,#1a5c32);color:#fff;border-radius:8px 8px 0 0">' +
        '<h3 style="margin:0;font-size:1rem">PROFIT & LOSS REPORT FOR ANAHUAC RV PARK LLC — ' + year + '</h3>' +
      '</div>' +
      '<table class="pnl-table" style="width:100%;border-collapse:collapse;font-size:0.75rem">' +
      '<thead><tr style="background:#f5f5f4"><th style="text-align:left;padding:0.5rem;min-width:180px;position:sticky;left:0;background:#f5f5f4;z-index:1">CATEGORY</th>';
    monthNames.forEach(function(m, i) {
      html += '<th style="text-align:right;padding:0.5rem;min-width:80px;' + (i === curMonth ? 'background:#e8f5e9;font-weight:800' : '') + '">' + m + '</th>';
    });
    html += '<th style="text-align:right;padding:0.5rem;min-width:95px;background:#e3f2fd;font-weight:800">YTD TOTAL</th></tr></thead><tbody>';

    // INCOME SECTION
    html += sectionHeader('INCOME', 14);
    html += pnlRow('Rental Income', data.months.map(function(m) { return m.rentalIncome; }), 'income', year, 'income');
    html += pnlRow('Electric Income', data.months.map(function(m) { return m.electricIncome; }), 'income', year, null);
    html += pnlRow('(Refunds)', data.months.map(function(m) { return -m.refunds; }), 'refund', year, null);
    html += totalRow('TOTAL INCOME', data.months.map(function(m) { return m.totalIncome; }), 'income-total');

    // EMPLOYEES
    if (data.allEmployees && data.allEmployees.length) {
      html += sectionHeader('EMPLOYEES', 14);
      data.allEmployees.forEach(function(emp) {
        var vals = data.months.map(function(m) {
          var found = m.employees.find(function(e) { return e.employee_name === emp.employee_name; });
          return found ? found.total : 0;
        });
        html += pnlRow('  ' + emp.employee_name, vals, 'expense', year, null);
      });
      html += totalRow('TOTAL EMPLOYEES', data.months.map(function(m) { return m.employeeTotal; }), 'expense-total');
    }

    // OWNERS/PARTNERS
    if (data.allOwners && data.allOwners.length) {
      html += sectionHeader('OWNERS/PARTNERS', 14);
      data.allOwners.forEach(function(own) {
        var vals = data.months.map(function(m) {
          var found = m.owners.find(function(e) { return e.employee_name === own.employee_name; });
          return found ? found.total : 0;
        });
        html += pnlRow('  ' + own.employee_name, vals, 'expense', year, null);
      });
      html += totalRow('TOTAL OWNERS/PARTNERS', data.months.map(function(m) { return m.ownerTotal; }), 'expense-total');
    }

    // EXPENSES
    html += sectionHeader('EXPENSES', 14);
    var catTotals = new Array(12).fill(0);
    (data.categories || []).forEach(function(cat) {
      var vals = data.months.map(function(m) { return m.expenses[cat.name] || 0; });
      if (vals.some(function(v) { return v > 0; })) {
        html += pnlRow(cat.name, vals, 'expense', year, cat.name);
        vals.forEach(function(v, i) { catTotals[i] += v; });
      }
    });
    html += totalRow('TOTAL EXPENSES', data.months.map(function(m) { return m.expenseTotal; }), 'expense-total');

    // NET PROFIT/LOSS
    html += '<tr style="background:linear-gradient(135deg,#f0fdf4,#e8f5e9);border-top:3px double #1a5c32">' +
      '<td style="padding:0.6rem;font-weight:900;font-size:0.85rem;position:sticky;left:0;background:linear-gradient(135deg,#f0fdf4,#e8f5e9);z-index:1">TOTAL — GAIN/LOSS</td>';
    var ytd = 0;
    data.months.forEach(function(m) {
      var color = m.netProfit >= 0 ? '#166534' : '#dc2626';
      ytd += m.netProfit;
      html += '<td style="text-align:right;padding:0.6rem;font-weight:900;font-size:0.85rem;color:' + color + '">' + fmtPnl(m.netProfit) + '</td>';
    });
    var ytdColor = ytd >= 0 ? '#166534' : '#dc2626';
    html += '<td style="text-align:right;padding:0.6rem;font-weight:900;font-size:0.9rem;color:' + ytdColor + ';background:#e3f2fd">' + fmtPnl(ytd) + '</td></tr>';

    html += '</tbody></table></div>';

    // Employee/Owner payment entry
    html += '<div style="display:flex;gap:0.75rem;margin-top:1rem;flex-wrap:wrap">' +
      '<button class="btn btn-primary" onclick="showEmployeePaymentForm(\'employee\')">+ Employee Payment</button>' +
      '<button class="btn btn-outline" onclick="showEmployeePaymentForm(\'owner\')">+ Owner/Partner Payment</button>' +
    '</div>';

    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load P&L: ' + escapeHtml(err.message || 'Unknown') + '</div>';
  }
}

function sectionHeader(title, colspan) {
  return '<tr><td colspan="' + colspan + '" style="padding:0.5rem;font-weight:800;font-size:0.82rem;color:#1a5c32;background:#f0fdf4;border-top:2px solid var(--gray-200);position:sticky;left:0">' + title + '</td></tr>';
}

function pnlRow(label, values, type, year, drillCategory) {
  var ytd = values.reduce(function(s, v) { return s + v; }, 0);
  if (ytd === 0 && !values.some(function(v) { return v !== 0; })) return '';
  var curMonth = new Date().getMonth();
  var html = '<tr><td style="padding:0.35rem 0.5rem;font-size:0.78rem;white-space:nowrap;position:sticky;left:0;background:#fff;z-index:1">' + escapeHtml(label) + '</td>';
  values.forEach(function(v, i) {
    var clickAttr = drillCategory ? ' onclick="showPnlDrilldown(\'' + escapeHtml(drillCategory) + '\',' + (i + 1) + ',' + year + ',\'' + type + '\')" style="cursor:pointer;text-align:right;padding:0.35rem 0.5rem;' : ' style="text-align:right;padding:0.35rem 0.5rem;';
    clickAttr += i === curMonth ? 'background:#e8f5e9;' : '';
    clickAttr += '"';
    var color = type === 'income' ? '#166534' : type === 'refund' ? '#dc2626' : '#78716c';
    html += '<td' + clickAttr + '>' + (v !== 0 ? '<span style="color:' + color + '">' + fmtPnl(v) + '</span>' : '<span style="color:#d4d4d8">—</span>') + '</td>';
  });
  html += '<td style="text-align:right;padding:0.35rem 0.5rem;font-weight:700;background:#e3f2fd">' + fmtPnl(ytd) + '</td></tr>';
  return html;
}

function totalRow(label, values, cls) {
  var ytd = values.reduce(function(s, v) { return s + v; }, 0);
  var curMonth = new Date().getMonth();
  var bg = cls === 'income-total' ? '#e8f5e9' : '#fef2f2';
  var color = cls === 'income-total' ? '#166534' : '#dc2626';
  var html = '<tr style="background:' + bg + ';border-top:1px solid var(--gray-300)"><td style="padding:0.4rem 0.5rem;font-weight:800;font-size:0.8rem;position:sticky;left:0;background:' + bg + ';z-index:1">' + label + '</td>';
  values.forEach(function(v, i) {
    html += '<td style="text-align:right;padding:0.4rem 0.5rem;font-weight:700;color:' + color + ';' + (i === curMonth ? 'background:#c8e6c9;' : '') + '">' + fmtPnl(v) + '</td>';
  });
  html += '<td style="text-align:right;padding:0.4rem 0.5rem;font-weight:800;color:' + color + ';background:#bbdefb">' + fmtPnl(ytd) + '</td></tr>';
  return html;
}

function fmtPnl(val) {
  if (val === 0) return '$0';
  var neg = val < 0;
  var abs = Math.abs(val);
  return (neg ? '-' : '') + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Drill-down modal
async function showPnlDrilldown(category, month, year, type) {
  try {
    var data = await API.get('/pnl/detail?year=' + year + '&month=' + month + '&category=' + encodeURIComponent(category) + '&type=' + type);
    var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var title = category + ' — ' + monthNames[month - 1] + ' ' + year;

    var html = '';
    if (data.items && data.items.length) {
      var total = data.items.reduce(function(s, i) { return s + (Number(i.amount || i.total_amount || i.rent_amount || 0)); }, 0);
      html += '<div class="table-container"><table><thead><tr>';
      if (type === 'income') {
        html += '<th>Invoice</th><th>Lot</th><th>Rent</th><th>Electric</th><th>Total</th><th>Status</th>';
      } else if (type === 'employee' || type === 'owner') {
        html += '<th>Name</th><th>Amount</th><th>Method</th><th>Notes</th>';
      } else {
        html += '<th>Date</th><th>Vendor</th><th>Amount</th><th>Description</th><th>Status</th>';
      }
      html += '</tr></thead><tbody>';
      data.items.forEach(function(i) {
        html += '<tr>';
        if (type === 'income') {
          html += '<td>' + escapeHtml(i.invoice_number || '') + '</td><td>' + escapeHtml(i.lot_id || '') + '</td><td>' + formatMoney(i.rent_amount || 0) + '</td><td>' + formatMoney(i.electric_amount || 0) + '</td><td><strong>' + formatMoney(i.total_amount || 0) + '</strong></td><td>' + escapeHtml(i.status || '') + '</td>';
        } else if (type === 'employee' || type === 'owner') {
          html += '<td>' + escapeHtml(i.employee_name || '') + '</td><td><strong>' + formatMoney(i.amount || 0) + '</strong></td><td>' + escapeHtml(i.payment_method || '') + '</td><td>' + escapeHtml(i.notes || '') + '</td>';
        } else {
          html += '<td>' + formatDate(i.expense_date) + '</td><td>' + escapeHtml(i.vendor_name || i.vendor || '') + '</td><td><strong>' + formatMoney(i.amount || 0) + '</strong></td><td>' + escapeHtml(i.description || '') + '</td><td>' + (i.status === 'filed' ? '✅ Filed' : '⏳ Pending') + '</td>';
        }
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      html += '<div style="text-align:right;font-weight:700;margin-top:0.5rem">Total: ' + formatMoney(total) + ' (' + data.items.length + ' records)</div>';
    } else {
      html = '<p style="text-align:center;color:#78716c">No records for this period</p>';
    }
    showModal('📊 ' + title, html);
  } catch (err) {
    alert('Could not load details: ' + (err.message || 'Unknown'));
  }
}

// Employee/Owner payment entry
async function showEmployeePaymentForm(role) {
  var title = role === 'employee' ? 'Employee Payment' : 'Owner/Partner Payment';
  var now = new Date();
  try {
    var names = await API.get('/employee-payments/names');
    var existing = (names || []).filter(function(n) { return role === 'employee' ? n.role === 'employee' : (n.role === 'owner' || n.role === 'partner'); });
    var datalist = existing.map(function(n) { return '<option value="' + escapeHtml(n.employee_name) + '">'; }).join('');

    showModal('+ ' + title,
      '<form id="emp-payment-form">' +
      '<div class="form-group"><label>Name *</label><input name="employee_name" list="emp-names-list" required placeholder="Enter name"><datalist id="emp-names-list">' + datalist + '</datalist></div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label>Month</label><select name="month">' +
          ['January','February','March','April','May','June','July','August','September','October','November','December'].map(function(m, i) {
            return '<option value="' + (i + 1) + '"' + (i === now.getMonth() ? ' selected' : '') + '>' + m + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="form-group"><label>Year</label><input name="year" type="number" value="' + now.getFullYear() + '"></div>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label>Amount ($) *</label><input name="amount" type="number" step="0.01" required></div>' +
        '<div class="form-group"><label>Payment Method</label><select name="payment_method"><option value="">—</option><option>Cash</option><option>Check</option><option>Direct Deposit</option><option>Zelle</option></select></div>' +
      '</div>' +
      '<div class="form-group"><label>Notes</label><input name="notes" placeholder="Optional"></div>' +
      '<input type="hidden" name="role" value="' + role + '">' +
      '<button type="submit" class="btn btn-primary btn-full">Save Payment</button></form>'
    );
    setTimeout(function() {
      document.getElementById('emp-payment-form')?.addEventListener('submit', async function(ev) {
        ev.preventDefault();
        var fd = Object.fromEntries(new FormData(ev.target));
        fd.amount = parseFloat(fd.amount) || 0;
        await API.post('/employee-payments', fd);
        closeModal();
        showStatusToast('✅', 'Payment recorded');
        var yearSel = document.getElementById('pnl-year');
        renderPnl(yearSel ? yearSel.value : new Date().getFullYear());
      });
    }, 50);
  } catch (err) {
    alert('Error: ' + (err.message || 'Unknown'));
  }
}

async function exportPnlCSV() {
  var year = document.getElementById('pnl-year')?.value || new Date().getFullYear();
  try {
    var res = await fetch('/api/pnl/export/csv?year=' + year, {
      headers: { 'Authorization': 'Bearer ' + API.token }
    });
    if (!res.ok) throw new Error('Export failed');
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'PnL-' + year + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showStatusToast('✅', 'P&L exported');
  } catch (err) {
    alert('Export failed: ' + (err.message || 'unknown'));
  }
}
