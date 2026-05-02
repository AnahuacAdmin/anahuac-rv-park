/*
 * Anahuac RV Park — Expense Tracking with AI Receipt Scanner
 */
var EXP_CATS = [
  'ELECTRICITY', 'VERIZON LAND LINE', 'PARK MOBILE PHONE', 'WATER/SEWER', 'DUMPSTER',
  'ENTERTAINMENT', 'STARLINK WIFI - GUEST', 'MAINTENANCE', 'MAINTENANCE REPAIRS',
  'LAWN MOWER PAYMENT', 'INSURANCE', 'ADVERTISING', 'UTILITY REPAIRS', 'BUILDING MATERIAL',
  'PROPERTY TAX', 'MEALS', 'PROFESSIONAL SERVICE', 'OFFICE SUPPLIES', 'RV PARK SUPPLIES',
  'FEES', 'APPLIANCE REPAIRS', 'PEST CONTROL', 'ROAD REPAIR MATERIAL', 'SECURITY',
  'FUEL', 'PLUMBING', 'TRACTOR REPAIR', 'Other'
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
      '<button class="btn btn-success" id="btn-snap-receipt">📷 Scan Receipt</button>' +
      '<button class="btn btn-outline" id="btn-upload-receipt">📄 Upload</button>' +
      '<button class="btn btn-outline" id="btn-export-csv">📥 Export CSV</button>' +
    '</div></div>' +

    // How-to guide
    '<details style="margin-bottom:1rem"><summary style="cursor:pointer;font-weight:700;font-size:0.88rem;color:var(--brand-primary);padding:0.5rem;background:#f0fdf4;border-radius:8px">❓ How to Record Expenses</summary>' +
    '<div class="card" style="margin-top:0.5rem;font-size:0.85rem">' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:1rem">' +
        '<div><strong>Option 1: Scan a Receipt</strong><ol style="margin:0.25rem 0 0;padding-left:1.25rem;color:var(--gray-600)">' +
          '<li>Tap "📷 Scan Receipt"</li><li>Take a photo of the receipt</li><li>AI reads vendor, amount, date</li><li>Review for accuracy</li><li>Tap "File Expense" to save</li></ol></div>' +
        '<div><strong>Option 2: Manual Entry</strong><ol style="margin:0.25rem 0 0;padding-left:1.25rem;color:var(--gray-600)">' +
          '<li>Tap "+ Add Expense"</li><li>Select vendor and category</li><li>Enter amount and date</li><li>Attach a receipt if you have one</li><li>Tap "Save" to file</li></ol></div>' +
        '<div><strong>Option 3: Upload Invoice</strong><ol style="margin:0.25rem 0 0;padding-left:1.25rem;color:var(--gray-600)">' +
          '<li>Tap "📄 Upload"</li><li>Select PDF or image</li><li>Fill in the details</li><li>Review and file</li></ol></div>' +
      '</div>' +
      '<div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--gray-200);font-size:0.82rem;color:var(--gray-500)">' +
        '<strong>Tips:</strong> Always attach a receipt for IRS compliance. Use "Pending Review" if unsure about a category. Check the P&L Report monthly.</div>' +
    '</div></details>' +

    // Summary cards
    '<div class="dash-top-bar" style="margin-bottom:1rem">' +
      '<div class="dash-top-item dash-border-red"><div class="dash-top-icon">💸</div><span class="dash-top-val">' + formatMoney((summary?.total || 0) + (summary?.recurringMonth || 0)) + '</span><span class="dash-top-label">Total Expenses (Month)</span></div>' +
      '<div class="dash-top-item dash-border-purple"><div class="dash-top-icon">📅</div><span class="dash-top-val">' + formatMoney((summary?.yearTotal || 0) + (summary?.recurringYear || 0)) + '</span><span class="dash-top-label">Total Expenses (Year)</span></div>' +
      '<div class="dash-top-item" style="border-left-color:#b45309"><div class="dash-top-icon">⚡</div><span class="dash-top-val">' + formatMoney(summary?.electricMonth || 0) + '</span><span class="dash-top-label">Electric Pass-Through (Month)</span></div>' +
      '<div class="dash-top-item dash-border-blue"><div class="dash-top-icon">📊</div><span class="dash-top-val">' + escapeHtml(topCat ? topCat.category : '—') + '</span><span class="dash-top-label">Biggest Category</span></div>' +
      '<div class="dash-top-item"><div class="dash-top-icon">🧾</div><span class="dash-top-val">' + (summary?.receiptCount || 0) + '</span><span class="dash-top-label">Receipts on File</span></div>' +
    '</div>' +

    // P&L Summary
    (function() {
      var revMonth = summary?.revenueMonth || 0;
      var refMonth = summary?.refundsMonth || 0;
      var netRevMonth = revMonth + refMonth;
      var elecMonth = summary?.electricMonth || 0;
      var manualExpMonth = summary?.total || 0;
      var recMonth = summary?.recurringMonth || 0;
      var totalExpMonth = elecMonth + manualExpMonth + recMonth;
      var profitMonth = netRevMonth - totalExpMonth;

      var revYear = summary?.revenueYear || 0;
      var refYear = summary?.refundsYear || 0;
      var netRevYear = revYear + refYear;
      var elecYear = summary?.electricYear || 0;
      var manualExpYear = summary?.yearTotal || 0;
      var recYear = summary?.recurringYear || 0;
      var totalExpYear = elecYear + manualExpYear + recYear;
      var profitYear = netRevYear - totalExpYear;

      return '<div class="card" style="margin-bottom:1rem;padding:1rem;background:linear-gradient(135deg,#fefce8,#fef9c3);border:1px solid #fde68a">' +
        '<h3 style="font-size:0.95rem;color:#92400e;margin:0 0 0.75rem">Profit & Loss Summary</h3>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;font-size:0.88rem">' +
          // Monthly column
          '<div>' +
            '<div style="font-weight:700;margin-bottom:0.5rem;color:var(--gray-600);font-size:0.8rem;text-transform:uppercase">This Month</div>' +
            '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Park Revenue:</span><strong style="color:#166534">' + formatMoney(revMonth) + '</strong></div>' +
            (refMonth < 0 ? '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Refunds:</span><strong style="color:#dc2626">' + formatMoney(refMonth) + '</strong></div>' : '') +
            '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Electric (pass-through):</span><strong style="color:#b45309">-' + formatMoney(elecMonth) + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Other Expenses:</span><strong style="color:#dc2626">-' + formatMoney(manualExpMonth) + '</strong></div>' +
            (recMonth > 0 ? '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Recurring Expenses:</span><strong style="color:#dc2626">-' + formatMoney(recMonth) + '</strong></div>' : '') +
            '<div style="display:flex;justify-content:space-between;padding:0.35rem 0;margin-top:0.25rem;border-top:2px solid #92400e;font-size:0.95rem"><span style="font-weight:700">Net Profit:</span><strong style="color:' + (profitMonth >= 0 ? '#166534' : '#dc2626') + ';font-size:1.05rem">' + formatMoney(profitMonth) + '</strong></div>' +
          '</div>' +
          // Year column
          '<div>' +
            '<div style="font-weight:700;margin-bottom:0.5rem;color:var(--gray-600);font-size:0.8rem;text-transform:uppercase">This Year</div>' +
            '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Park Revenue:</span><strong style="color:#166534">' + formatMoney(revYear) + '</strong></div>' +
            (refYear < 0 ? '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Refunds:</span><strong style="color:#dc2626">' + formatMoney(refYear) + '</strong></div>' : '') +
            '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Electric (pass-through):</span><strong style="color:#b45309">-' + formatMoney(elecYear) + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Other Expenses:</span><strong style="color:#dc2626">-' + formatMoney(manualExpYear) + '</strong></div>' +
            (recYear > 0 ? '<div style="display:flex;justify-content:space-between;padding:0.2rem 0"><span>Recurring Expenses:</span><strong style="color:#dc2626">-' + formatMoney(recYear) + '</strong></div>' : '') +
            '<div style="display:flex;justify-content:space-between;padding:0.35rem 0;margin-top:0.25rem;border-top:2px solid #92400e;font-size:0.95rem"><span style="font-weight:700">Net Profit:</span><strong style="color:' + (profitYear >= 0 ? '#166534' : '#dc2626') + ';font-size:1.05rem">' + formatMoney(profitYear) + '</strong></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    })() +

    // Electric pass-through auto-entry
    '<div class="card" style="margin-bottom:1rem;padding:0.75rem;background:#fffbeb;border:1px solid #fde68a">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><strong style="color:#b45309">&#9889; Electric Pass-Through</strong>' +
          '<span style="font-size:0.78rem;color:var(--gray-500);margin-left:0.5rem">Auto-calculated from guest electric billing</span></div>' +
        '<div style="text-align:right">' +
          '<div style="font-size:1.1rem;font-weight:700;color:#b45309">' + formatMoney(summary?.electricMonth || 0) + '</div>' +
          '<div style="font-size:0.75rem;color:var(--gray-500)">This month &bull; ' + formatMoney(summary?.electricYear || 0) + ' YTD</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Recurring Expenses section
    '<div class="card" style="margin-bottom:1rem;padding:1rem;border-left:4px solid #7c3aed">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">' +
        '<h3 style="font-size:0.95rem;color:#7c3aed;margin:0">🔁 Recurring Expenses</h3>' +
        '<button class="btn btn-sm btn-outline" onclick="showRecurringForm()" style="font-size:0.75rem">+ Add Recurring</button>' +
      '</div>' +
      '<div id="recurring-list">' +
        ((summary?.recurringItems || []).length ? (summary.recurringItems.map(function(r) {
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid #e7e5e4">' +
            '<div style="flex:1">' +
              '<div style="font-weight:700;font-size:0.88rem">' + escapeHtml(r.name) +
                (r.is_active ? ' <span class="badge badge-success" style="font-size:0.55rem">Active</span>' : ' <span class="badge badge-gray" style="font-size:0.55rem">Disabled</span>') +
                ' <span class="badge badge-info" style="font-size:0.55rem">' + escapeHtml(r.frequency) + '</span>' +
              '</div>' +
              '<div style="font-size:0.78rem;color:#78716c">' + escapeHtml(r.description || '') + '</div>' +
              '<div style="font-size:0.82rem;margin-top:0.15rem">' + r.quantity + ' × ' + formatMoney(r.amount_per_unit) + ' = <strong>' + formatMoney(r.total_amount) + '/' + (r.frequency === 'monthly' ? 'mo' : r.frequency === 'quarterly' ? 'qtr' : 'yr') + '</strong></div>' +
            '</div>' +
            '<div class="btn-group" style="gap:4px;flex-shrink:0;margin-left:0.5rem">' +
              '<button class="btn btn-sm btn-outline" onclick="showRecurringForm(' + r.id + ')">Edit</button>' +
              '<button class="btn btn-sm btn-danger" onclick="deleteRecurring(' + r.id + ')">Del</button>' +
            '</div>' +
          '</div>';
        }).join('')) : '<p style="color:#78716c;font-size:0.85rem">No recurring expenses yet</p>') +
      '</div>' +
      (summary?.recurringMonth > 0 ? '<div style="margin-top:0.5rem;font-size:0.85rem;font-weight:700;text-align:right;color:#7c3aed">Monthly Total: ' + formatMoney(summary.recurringMonth) + '</div>' : '') +
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
    document.getElementById('btn-upload-receipt')?.addEventListener('click', showUploadReceipt);
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
      '<thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th><th>Receipt</th><th>Actions</th></tr></thead><tbody>' +
      list.map(function(e) {
        var receiptCol = e.has_receipt
          ? '<a href="/api/expenses/' + e.id + '/receipt" target="_blank" style="font-size:0.75rem;color:var(--brand-primary);font-weight:600" title="View receipt">🧾 View</a>'
          : '<span style="color:#a8a29e;font-size:0.72rem">—</span>';
        var statusBadge = e.status === 'filed' ? '<span class="badge badge-success" style="font-size:0.6rem">✅ Filed</span>'
          : e.status === 'pending' ? '<span class="badge badge-warning" style="font-size:0.6rem">⏳ Review</span>'
          : '<span class="badge badge-gray" style="font-size:0.6rem">📝 Draft</span>';
        return '<tr>' +
          '<td>' + formatDate(e.expense_date) + '</td>' +
          '<td><strong>' + escapeHtml(e.vendor || '—') + '</strong></td>' +
          '<td><span class="badge badge-gray" style="font-size:0.65rem">' + escapeHtml(e.category) + '</span></td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(e.description || '') + '</td>' +
          '<td><strong>' + formatMoney(e.amount) + '</strong></td>' +
          '<td>' + statusBadge + '</td>' +
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

  // Fetch vendors for dropdown
  var vendorList = [];
  try { vendorList = await API.get('/vendors') || []; } catch {}
  var vendorOpts = '<option value="">— Select Vendor —</option>' + vendorList.map(function(v) {
    return '<option value="' + v.id + '"' + (e.vendor_id == v.id || e.vendor === v.name ? ' selected' : '') + '>' + escapeHtml(v.name) + '</option>';
  }).join('');

  showModal(title,
    '<form id="expense-form">' +
    '<div class="form-row"><div class="form-group"><label>Date *</label><input name="expense_date" type="date" value="' + (e.expense_date || today) + '" required></div>' +
    '<div class="form-group"><label>Amount ($) *</label><input name="amount" type="number" step="0.01" value="' + (e.amount || '') + '" required></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Category</label><select name="category">' +
      EXP_CATS.map(function(c) { return '<option' + (c === e.category ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
    '</select></div><div class="form-group"><label>Vendor</label><select name="vendor_id">' + vendorOpts + '</select></div></div>' +
    '<div class="form-group"><label>Vendor (manual)</label><input name="vendor" value="' + _escAttr(e.vendor || '') + '" placeholder="Or type vendor name if not in list"></div>' +
    '<div class="form-group"><label>Description</label><input name="description" value="' + _escAttr(e.description || '') + '" placeholder="What was purchased/paid for"></div>' +
    '<div class="form-row"><div class="form-group"><label>Paid By</label><select name="paid_by">' +
      ['','Cash','Check','Credit Card','Debit Card','Autopay','Zelle','ACH'].map(function(m) {
        return '<option value="' + m + '"' + (e.paid_by === m ? ' selected' : '') + '>' + (m || '— Select —') + '</option>';
      }).join('') +
    '</select></div><div class="form-group"><label>Status</label><select name="status">' +
      '<option value="draft"' + (e.status === 'draft' ? ' selected' : '') + '>⏳ Draft</option>' +
      '<option value="pending"' + (e.status === 'pending' ? ' selected' : '') + '>⏳ Pending Review</option>' +
      '<option value="filed"' + (!e.status || e.status === 'filed' ? ' selected' : '') + '>✅ Filed</option>' +
    '</select></div></div>' +
    (!editId ? '<div class="form-group"><label>Receipt Photo <span style="color:#a8a29e">(optional)</span></label>' +
      '<input type="file" id="expense-receipt-file" accept="image/*,application/pdf" onchange="handleExpenseReceipt(event)">' +
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
      if (data.vendor_id) data.vendor_id = Number(data.vendor_id) || null;
      else delete data.vendor_id;
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
  showStatusToast('✅', 'Expense deleted');
  loadExpenses();
}

// --- Recurring Expenses ---
async function showRecurringForm(editId) {
  var existing = null;
  if (editId) {
    var all = await API.get('/expenses/recurring');
    existing = (all || []).find(function(r) { return r.id === editId; });
  }
  var cats = EXP_CATS.map(function(c) {
    return '<option value="' + c + '"' + (existing && existing.category === c ? ' selected' : '') + '>' + c + '</option>';
  }).join('');
  showModal(existing ? 'Edit Recurring Expense' : 'Add Recurring Expense', `
    <form onsubmit="saveRecurring(event, ${editId || 'null'})">
      <div class="form-group"><label>Name</label><input name="name" required value="${existing ? existing.name : ''}"></div>
      <div class="form-group"><label>Description</label><input name="description" value="${existing ? (existing.description || '') : ''}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem">
        <div class="form-group"><label>Quantity</label><input name="quantity" type="number" step="1" min="1" value="${existing ? existing.quantity : 1}" oninput="recalcRecurring()"></div>
        <div class="form-group"><label>Cost per Unit ($)</label><input name="amount_per_unit" type="number" step="0.01" min="0" value="${existing ? existing.amount_per_unit : '0.00'}" oninput="recalcRecurring()"></div>
        <div class="form-group"><label>Total</label><input name="total_display" type="text" readonly style="background:#f5f5f4;font-weight:700" value="$${existing ? existing.total_amount.toFixed(2) : '0.00'}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <div class="form-group"><label>Frequency</label><select name="frequency">
          <option value="monthly"${existing && existing.frequency === 'monthly' ? ' selected' : ''}>Monthly</option>
          <option value="quarterly"${existing && existing.frequency === 'quarterly' ? ' selected' : ''}>Quarterly</option>
          <option value="annually"${existing && existing.frequency === 'annually' ? ' selected' : ''}>Annually</option>
        </select></div>
        <div class="form-group"><label>Category</label><select name="category">${cats}</select></div>
      </div>
      ${existing ? '<div class="form-group"><label><input type="checkbox" name="is_active" ' + (existing.is_active ? 'checked' : '') + '> Active</label></div>' : ''}
      <button type="submit" class="btn btn-green" style="margin-top:0.5rem">${existing ? 'Update' : 'Add'} Recurring Expense</button>
    </form>
  `);
}

function recalcRecurring() {
  var qty = Number(document.querySelector('[name="quantity"]')?.value) || 0;
  var unit = Number(document.querySelector('[name="amount_per_unit"]')?.value) || 0;
  var display = document.querySelector('[name="total_display"]');
  if (display) display.value = '$' + (qty * unit).toFixed(2);
}

async function saveRecurring(e, editId) {
  e.preventDefault();
  var f = new FormData(e.target);
  var data = {
    name: f.get('name'), description: f.get('description'),
    quantity: Number(f.get('quantity')) || 1, amount_per_unit: Number(f.get('amount_per_unit')) || 0,
    frequency: f.get('frequency'), category: f.get('category'),
    is_active: editId ? (e.target.querySelector('[name="is_active"]')?.checked ? 1 : 0) : 1
  };
  if (editId) {
    await API.put('/expenses/recurring/' + editId, data);
  } else {
    await API.post('/expenses/recurring', data);
  }
  closeModal();
  showStatusToast('✅', 'Recurring expense saved');
  loadExpenses();
}

async function deleteRecurring(id) {
  if (!confirm('Delete this recurring expense?')) return;
  await API.del('/expenses/recurring/' + id);
  showStatusToast('✅', 'Recurring expense deleted');
  loadExpenses();
}

// Upload invoice/receipt (PDF or Image)
function showUploadReceipt() {
  showModal('📄 Upload Invoice/Receipt',
    '<div style="text-align:center;margin-bottom:1rem">' +
      '<p style="color:var(--gray-600);font-size:0.9rem;margin:0">Upload a PDF, JPEG, or PNG file. If it\'s an image, AI will try to read the details.</p>' +
    '</div>' +
    '<div class="form-group">' +
      '<label><strong>Select file</strong></label>' +
      '<input type="file" id="upload-receipt-input" accept="image/*,application/pdf">' +
    '</div>' +
    '<div id="upload-preview" style="text-align:center;margin-top:0.5rem"></div>' +
    '<div id="upload-status" style="text-align:center;margin-top:0.75rem;display:none"></div>'
  );
  setTimeout(function() {
    document.getElementById('upload-receipt-input')?.addEventListener('change', handleUploadReceipt);
  }, 50);
}

async function handleUploadReceipt(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large. Max 10 MB.'); return; }

  var preview = document.getElementById('upload-preview');
  var status = document.getElementById('upload-status');

  var reader = new FileReader();
  reader.onload = async function(ev) {
    var dataUrl = ev.target.result;
    var b64 = dataUrl.split(',')[1];
    var mime = file.type || 'image/jpeg';

    if (mime.startsWith('image/')) {
      preview.innerHTML = '<img src="' + dataUrl + '" style="max-width:260px;max-height:200px;border-radius:8px;border:1px solid #e5e7eb">';
      // Try AI scan
      status.style.display = '';
      status.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;color:var(--brand-primary);font-weight:600"><div class="loading-spinner" style="width:20px;height:20px"></div> Scanning with AI...</div>';
      try {
        var result = await API.post('/expenses/scan-receipt', { image: b64, mime: mime });
        status.innerHTML = '<div style="color:#16a34a;font-weight:600">✅ Scanned! Opening form...</div>';
        setTimeout(function() { closeModal(); showExpenseFormWithScan(result, b64); }, 600);
      } catch {
        status.innerHTML = '<div style="color:#f59e0b">Could not auto-read. Opening manual form...</div>';
        setTimeout(function() { closeModal(); showExpenseFormWithScan({}, b64); }, 600);
      }
    } else {
      // PDF — just attach to manual form
      preview.innerHTML = '<div style="font-size:2rem;margin-bottom:0.5rem">📄</div><div style="font-size:0.85rem">' + escapeHtml(file.name) + '</div>';
      status.style.display = '';
      status.innerHTML = '<div style="color:var(--brand-primary);font-weight:600">PDF attached. Opening form...</div>';
      setTimeout(function() { closeModal(); showExpenseFormWithScan({}, b64); }, 600);
    }
  };
  reader.readAsDataURL(file);
}
