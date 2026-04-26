/*
 * Anahuac RV Park — Expense Tracking with AI Receipt Scanner
 */
var EXP_CATS = [
  'Electric/Utilities', 'Plumbing/Water', 'Maintenance/Repairs', 'Supplies/Hardware',
  'Landscaping', 'Insurance', 'Taxes/Fees', 'Equipment', 'Labor/Contractors', 'Office/Admin', 'Other'
];

async function loadExpenses() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  var today = new Date().toISOString().split('T')[0];
  var summary = await API.get('/expenses/summary');

  var topCat = (summary?.byCategory || [])[0];
  document.getElementById('page-content').innerHTML =
    helpPanel('expenses') +
    '<div class="page-header"><h2>💸 Expenses</h2>' +
    '<div class="btn-group">' +
      '<button class="btn btn-primary" id="btn-add-expense">+ Add Expense</button>' +
      '<button class="btn btn-success" id="btn-snap-receipt">📷 Snap Receipt</button>' +
      '<button class="btn btn-outline" id="btn-export-csv">📥 Export CSV</button>' +
    '</div></div>' +

    // Summary cards
    '<div class="dash-top-bar" style="margin-bottom:1rem">' +
      '<div class="dash-top-item dash-border-red"><div class="dash-top-icon">💸</div><span class="dash-top-val">' + formatMoney(summary?.total || 0) + '</span><span class="dash-top-label">This Month</span></div>' +
      '<div class="dash-top-item dash-border-purple"><div class="dash-top-icon">📅</div><span class="dash-top-val">' + formatMoney(summary?.yearTotal || 0) + '</span><span class="dash-top-label">This Year</span></div>' +
      '<div class="dash-top-item dash-border-blue"><div class="dash-top-icon">📊</div><span class="dash-top-val">' + escapeHtml(topCat ? topCat.category : '—') + '</span><span class="dash-top-label">Biggest Category</span></div>' +
      '<div class="dash-top-item"><div class="dash-top-icon">🧾</div><span class="dash-top-val">' + (summary?.receiptCount || 0) + '</span><span class="dash-top-label">Receipts on File</span></div>' +
    '</div>' +

    // Monthly chart + top vendors
    '<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem">' +
      '<div class="card" style="flex:2;min-width:280px"><h3>Monthly Spending (Last 6 Months)</h3><div style="position:relative;height:200px"><canvas id="expenseChart"></canvas></div></div>' +
      '<div class="card" style="flex:1;min-width:200px"><h3>Top Vendors (Year)</h3><div id="exp-top-vendors" style="font-size:0.85rem"></div></div>' +
    '</div>' +

    // Filters
    '<div class="filter-bar">' +
      '<select id="exp-cat-filter"><option value="all">All Categories</option>' +
        EXP_CATS.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') +
      '</select>' +
      '<input type="date" id="exp-from" value="' + today.slice(0, 7) + '-01">' +
      '<input type="date" id="exp-to" value="' + today + '">' +
      '<button class="btn btn-sm btn-outline" id="btn-filter-exp">Filter</button>' +
    '</div>' +
    '<div id="exp-list">Loading...</div>';

  setTimeout(function() {
    document.getElementById('btn-add-expense')?.addEventListener('click', function() { showExpenseForm(); });
    document.getElementById('btn-snap-receipt')?.addEventListener('click', showSnapReceipt);
    document.getElementById('btn-filter-exp')?.addEventListener('click', refreshExpList);
    document.getElementById('btn-export-csv')?.addEventListener('click', exportExpensesCSV);
  }, 50);

  refreshExpList();
  renderExpenseChart(summary);
  renderTopVendors(summary?.topVendors || []);
}

function renderExpenseChart(summary) {
  if (!summary?.monthlyHistory || typeof Chart === 'undefined') return;
  setTimeout(function() {
    var canvas = document.getElementById('expenseChart');
    if (!canvas) return;
    new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: summary.monthlyHistory.map(function(m) {
          var parts = m.month.split('-');
          return new Date(parts[0], parts[1] - 1).toLocaleDateString('en-US', { month: 'short' });
        }),
        datasets: [{ label: 'Expenses', data: summary.monthlyHistory.map(function(m) { return m.total; }), backgroundColor: '#dc2626', borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return '$' + v; } } } } }
    });
  }, 100);
}

function renderTopVendors(vendors) {
  var el = document.getElementById('exp-top-vendors');
  if (!el) return;
  if (!vendors.length) { el.innerHTML = '<p style="color:#78716c">No vendor data yet</p>'; return; }
  el.innerHTML = vendors.map(function(v, i) {
    return '<div style="display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid var(--gray-100)">' +
      '<span>' + (i + 1) + '. ' + escapeHtml(v.vendor) + '</span>' +
      '<strong>' + formatMoney(v.total) + '</strong></div>';
  }).join('');
}

async function refreshExpList() {
  var el = document.getElementById('exp-list');
  if (!el) return;
  var cat = (document.getElementById('exp-cat-filter') || {}).value || 'all';
  var from = (document.getElementById('exp-from') || {}).value || '';
  var to = (document.getElementById('exp-to') || {}).value || '';
  var url = '/expenses?category=' + encodeURIComponent(cat) + '&from=' + from + '&to=' + to;
  try {
    var list = await API.get(url);
    if (!list || !list.length) { el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">No expenses found for this period</div>'; return; }
    var total = list.reduce(function(s, e) { return s + (Number(e.amount) || 0); }, 0);
    el.innerHTML = '<div class="card"><div class="table-container"><table>' +
      '<thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Description</th><th>Amount</th><th>Receipt</th><th>Actions</th></tr></thead><tbody>' +
      list.map(function(e) {
        var receiptCol = e.has_receipt
          ? '<a href="/api/expenses/' + e.id + '/receipt" target="_blank" style="font-size:0.75rem;color:var(--brand-primary);font-weight:600" title="View receipt">🧾 View</a>'
          : '<span style="color:#a8a29e;font-size:0.72rem">—</span>';
        return '<tr>' +
          '<td>' + formatDate(e.expense_date) + '</td>' +
          '<td><strong>' + escapeHtml(e.vendor || '—') + '</strong></td>' +
          '<td><span class="badge badge-gray" style="font-size:0.65rem">' + escapeHtml(e.category) + '</span></td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(e.description || '') + '</td>' +
          '<td><strong>' + formatMoney(e.amount) + '</strong></td>' +
          '<td>' + receiptCol + '</td>' +
          '<td class="btn-group">' +
            '<button class="btn btn-sm btn-outline" onclick="showExpenseForm(' + e.id + ')">Edit</button>' +
            '<button class="btn btn-sm btn-danger" onclick="deleteExpense(' + e.id + ')">Del</button>' +
          '</td></tr>';
      }).join('') +
      '<tr style="border-top:2px solid var(--gray-900)"><td colspan="4"><strong>Total (' + list.length + ' expenses)</strong></td><td><strong>' + formatMoney(total) + '</strong></td><td colspan="2"></td></tr>' +
      '</tbody></table></div></div>';
  } catch { el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load expenses</div>'; }
}

async function showExpenseForm(editId) {
  var today = new Date().toISOString().split('T')[0];
  var existing = null;
  if (editId) {
    try {
      var list = await API.get('/expenses');
      existing = (list || []).find(function(e) { return e.id === editId; });
    } catch {}
  }
  var e = existing || {};
  var title = editId ? 'Edit Expense' : '+ Add Expense';

  showModal(title,
    '<form id="expense-form">' +
    '<div class="form-row"><div class="form-group"><label>Date *</label><input name="expense_date" type="date" value="' + (e.expense_date || today) + '" required></div>' +
    '<div class="form-group"><label>Amount ($) *</label><input name="amount" type="number" step="0.01" value="' + (e.amount || '') + '" required></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Category</label><select name="category">' +
      EXP_CATS.map(function(c) { return '<option' + (c === e.category ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
    '</select></div><div class="form-group"><label>Vendor</label><input name="vendor" value="' + _escAttr(e.vendor || '') + '" placeholder="e.g. Home Depot"></div></div>' +
    '<div class="form-group"><label>Description</label><input name="description" value="' + _escAttr(e.description || '') + '" placeholder="What was purchased/paid for"></div>' +
    '<div class="form-group"><label>Paid By</label><input name="paid_by" value="' + _escAttr(e.paid_by || '') + '" placeholder="Cash, Card, Check..."></div>' +
    (!editId ? '<div class="form-group"><label>Receipt Photo <span style="color:#a8a29e">(optional)</span></label>' +
      '<input type="file" id="expense-receipt-file" accept="image/*" onchange="handleExpenseReceipt(event)">' +
      '<div id="expense-receipt-preview" style="margin-top:0.5rem"></div>' +
      '<input type="hidden" id="expense-receipt-data" name="receipt_photo">' +
    '</div>' : '') +
    '<div id="expense-ai-badge" style="display:none;margin-bottom:0.75rem"></div>' +
    '<button type="submit" class="btn btn-primary btn-full">' + (editId ? 'Update' : 'Save') + ' Expense</button></form>'
  );
  setTimeout(function() {
    var form = document.getElementById('expense-form');
    if (form) form.addEventListener('submit', async function(ev) {
      ev.preventDefault();
      var data = Object.fromEntries(new FormData(ev.target));
      data.amount = parseFloat(data.amount) || 0;
      if (!data.receipt_photo) delete data.receipt_photo;
      if (editId) {
        await API.put('/expenses/' + editId, data);
        showStatusToast('✅', 'Expense updated');
      } else {
        await API.post('/expenses', data);
        showStatusToast('✅', 'Expense saved');
      }
      closeModal();
      loadExpenses();
    });
  }, 50);
}

function _escAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

var _expReceiptB64 = null;
function handleExpenseReceipt(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large. Max 10 MB.'); event.target.value = ''; return; }
  var reader = new FileReader();
  reader.onload = function(ev) {
    var b64 = ev.target.result.split(',')[1];
    _expReceiptB64 = b64;
    document.getElementById('expense-receipt-data').value = b64;
    document.getElementById('expense-receipt-preview').innerHTML =
      '<img src="' + ev.target.result + '" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid #e5e7eb">';
  };
  reader.readAsDataURL(file);
}

// === SNAP RECEIPT — AI Scanner ===
function showSnapReceipt() {
  showModal('📷 Snap Receipt',
    '<div style="text-align:center;margin-bottom:1rem">' +
      '<p style="color:var(--gray-600);font-size:0.9rem;margin:0">Take a photo of a receipt and AI will automatically read the vendor, amount, date, and items.</p>' +
    '</div>' +
    '<div class="form-group">' +
      '<label><strong>Choose or take a photo</strong></label>' +
      '<input type="file" id="snap-receipt-input" accept="image/*" capture="environment" onchange="handleSnapReceipt(event)">' +
    '</div>' +
    '<div id="snap-preview" style="text-align:center;margin-top:0.5rem"></div>' +
    '<div id="snap-status" style="text-align:center;margin-top:0.75rem;display:none"></div>'
  );
}

async function handleSnapReceipt(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large. Max 10 MB.'); return; }

  var preview = document.getElementById('snap-preview');
  var status = document.getElementById('snap-status');

  // Show preview
  var reader = new FileReader();
  reader.onload = async function(ev) {
    var dataUrl = ev.target.result;
    var b64 = dataUrl.split(',')[1];
    var mime = file.type || 'image/jpeg';
    preview.innerHTML = '<img src="' + dataUrl + '" style="max-width:260px;max-height:200px;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:0.5rem">';

    // Scan with AI
    status.style.display = '';
    status.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;color:var(--brand-primary);font-weight:600"><div class="loading-spinner" style="width:20px;height:20px"></div> Scanning receipt with AI...</div>';

    try {
      var result = await API.post('/expenses/scan-receipt', { image: b64, mime: mime });
      status.innerHTML = '<div style="color:#16a34a;font-weight:600">✅ Receipt scanned! Auto-filling form...</div>';
      setTimeout(function() {
        closeModal();
        showExpenseFormWithScan(result, b64);
      }, 800);
    } catch (err) {
      status.innerHTML = '<div style="color:#f59e0b;font-weight:600">⚠️ Could not read receipt: ' + escapeHtml(err.message || 'unknown') + '</div>' +
        '<button class="btn btn-outline" style="margin-top:0.5rem" onclick="closeModal();showExpenseForm()">Enter manually instead</button>';
    }
  };
  reader.readAsDataURL(file);
}

function showExpenseFormWithScan(data, receiptB64) {
  var today = new Date().toISOString().split('T')[0];
  var allFilled = data.vendor && data.date && data.amount && data.category;
  var badgeColor = allFilled ? '#16a34a' : '#f59e0b';
  var badgeText = allFilled ? '✅ Auto-filled from receipt' : '⚠️ Some fields could not be read — please verify';

  showModal('📷 Add Expense from Receipt',
    '<div id="expense-ai-badge" style="background:' + (allFilled ? '#f0fdf4' : '#fffbeb') + ';border:1px solid ' + (allFilled ? '#a7f3d0' : '#fde68a') + ';border-radius:8px;padding:0.5rem 0.75rem;margin-bottom:1rem;font-size:0.82rem;color:' + badgeColor + ';font-weight:600">' + badgeText + '</div>' +
    '<form id="expense-form">' +
    '<div class="form-row"><div class="form-group"><label>Date *</label><input name="expense_date" type="date" value="' + (data.date || today) + '" required></div>' +
    '<div class="form-group"><label>Amount ($) *</label><input name="amount" type="number" step="0.01" value="' + (data.amount || '') + '" required></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Category</label><select name="category">' +
      EXP_CATS.map(function(c) { return '<option' + (c === data.category ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
    '</select></div><div class="form-group"><label>Vendor</label><input name="vendor" value="' + _escAttr(data.vendor || '') + '"></div></div>' +
    '<div class="form-group"><label>Description</label><input name="description" value="' + _escAttr(data.items || '') + '"></div>' +
    '<div class="form-group"><label>Paid By</label><input name="paid_by" placeholder="Cash, Card, Check..."></div>' +
    '<input type="hidden" name="receipt_photo" value="' + (receiptB64 || '') + '">' +
    (receiptB64 ? '<div style="margin-bottom:0.75rem"><img src="data:image/jpeg;base64,' + receiptB64.slice(0, 100) + '..." style="display:none"><p style="font-size:0.78rem;color:#16a34a">🧾 Receipt photo attached</p></div>' : '') +
    '<button type="submit" class="btn btn-primary btn-full">Save Expense</button></form>'
  );
  // Show actual receipt thumbnail
  if (receiptB64) {
    try {
      var img = document.createElement('img');
      img.src = 'data:image/jpeg;base64,' + receiptB64;
      img.style.cssText = 'max-width:120px;max-height:80px;border-radius:6px;border:1px solid #e5e7eb;display:block;margin-bottom:0.5rem';
      var badge = document.getElementById('expense-ai-badge');
      if (badge) badge.parentElement.querySelector('[type="hidden"]')?.before(img);
    } catch {}
  }
  setTimeout(function() {
    var form = document.getElementById('expense-form');
    if (form) form.addEventListener('submit', async function(ev) {
      ev.preventDefault();
      var formData = Object.fromEntries(new FormData(ev.target));
      formData.amount = parseFloat(formData.amount) || 0;
      if (!formData.receipt_photo) delete formData.receipt_photo;
      await API.post('/expenses', formData);
      closeModal();
      showStatusToast('✅', 'Expense saved with receipt');
      loadExpenses();
    });
  }, 50);
}

async function exportExpensesCSV() {
  var from = (document.getElementById('exp-from') || {}).value || '';
  var to = (document.getElementById('exp-to') || {}).value || '';
  try {
    var res = await fetch('/api/expenses/export/csv?from=' + from + '&to=' + to, {
      headers: { 'Authorization': 'Bearer ' + API.token }
    });
    if (!res.ok) throw new Error('Export failed');
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'expenses-' + (from || 'all') + '-to-' + (to || 'now') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showStatusToast('✅', 'CSV exported');
  } catch (err) {
    alert('Export failed: ' + (err.message || 'unknown'));
  }
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  await API.del('/expenses/' + id);
  refreshExpList();
}
