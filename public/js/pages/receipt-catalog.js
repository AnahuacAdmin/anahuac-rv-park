/*
 * Anahuac RV Park — Receipt Catalog
 */

async function loadReceiptCatalog() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }

  var now = new Date();
  var currentMonth = now.toISOString().slice(0, 7);

  document.getElementById('page-content').innerHTML =
    helpPanel('receipt-catalog') +
    '<div class="page-header"><h2>🧾 Receipt Catalog</h2></div>' +

    // Month tabs
    '<div id="receipt-month-tabs" style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-bottom:1rem"></div>' +

    // Filters
    '<div class="filter-bar">' +
      '<input type="text" id="receipt-search" placeholder="Search vendor or description..." style="flex:1;max-width:300px">' +
      '<select id="receipt-cat-filter"><option value="all">All Categories</option></select>' +
      '<input type="number" id="receipt-min" placeholder="Min $" style="width:80px">' +
      '<input type="number" id="receipt-max" placeholder="Max $" style="width:80px">' +
      '<button class="btn btn-sm btn-outline" id="btn-receipt-filter">Filter</button>' +
    '</div>' +

    // Summary + grid
    '<div id="receipt-summary" style="margin-bottom:1rem"></div>' +
    '<div id="receipt-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.75rem">Loading...</div>';

  // Build month tabs (last 12 months)
  var tabsHtml = '';
  for (var i = 0; i < 12; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var m = d.toISOString().slice(0, 7);
    var label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
    var active = m === currentMonth ? 'background:var(--brand-primary);color:#fff;' : 'background:var(--gray-100);';
    tabsHtml += '<button class="btn btn-sm" style="' + active + 'border-radius:20px;font-size:0.75rem" onclick="loadReceiptsForMonth(\'' + m + '\',this)">' + label + '</button>';
  }
  document.getElementById('receipt-month-tabs').innerHTML = tabsHtml;

  setTimeout(function() {
    document.getElementById('btn-receipt-filter')?.addEventListener('click', function() { loadReceiptsForMonth(window._receiptMonth); });
  }, 50);
  loadReceiptsForMonth(currentMonth);
}

async function loadReceiptsForMonth(month, btn) {
  window._receiptMonth = month || new Date().toISOString().slice(0, 7);

  // Update active tab
  if (btn) {
    document.querySelectorAll('#receipt-month-tabs .btn').forEach(function(b) { b.style.background = 'var(--gray-100)'; b.style.color = ''; });
    btn.style.background = 'var(--brand-primary)';
    btn.style.color = '#fff';
  }

  var grid = document.getElementById('receipt-grid');
  var summary = document.getElementById('receipt-summary');
  if (!grid) return;
  grid.innerHTML = '<div style="text-align:center;padding:2rem;grid-column:1/-1"><div class="loading-spinner"></div></div>';

  try {
    var search = document.getElementById('receipt-search')?.value || '';
    var cat = document.getElementById('receipt-cat-filter')?.value || 'all';
    var minAmt = document.getElementById('receipt-min')?.value || '';
    var maxAmt = document.getElementById('receipt-max')?.value || '';

    var url = '/expenses?from=' + month + '-01&to=' + month + '-31';
    if (cat !== 'all') url += '&category=' + encodeURIComponent(cat);
    if (search) url += '&vendor=' + encodeURIComponent(search);

    var expenses = await API.get(url);
    // Filter to only those with receipts (unless searching)
    var withReceipts = (expenses || []).filter(function(e) { return e.has_receipt; });
    var all = expenses || [];

    // Apply amount filter
    if (minAmt) withReceipts = withReceipts.filter(function(e) { return Number(e.amount) >= Number(minAmt); });
    if (maxAmt) withReceipts = withReceipts.filter(function(e) { return Number(e.amount) <= Number(maxAmt); });

    // Summary
    var totalAmount = withReceipts.reduce(function(s, e) { return s + (Number(e.amount) || 0); }, 0);
    var byCategory = {};
    withReceipts.forEach(function(e) {
      byCategory[e.category] = (byCategory[e.category] || 0) + (Number(e.amount) || 0);
    });

    // Populate category filter if not done
    var catFilter = document.getElementById('receipt-cat-filter');
    if (catFilter && catFilter.options.length <= 1) {
      var cats = {};
      all.forEach(function(e) { cats[e.category] = true; });
      Object.keys(cats).sort().forEach(function(c) {
        var opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        catFilter.appendChild(opt);
      });
    }

    var monthLabel = new Date(month + '-15').toLocaleString('default', { month: 'long', year: 'numeric' });
    summary.innerHTML = '<div class="dash-top-bar">' +
      '<div class="dash-top-item"><div class="dash-top-icon">🧾</div><span class="dash-top-val">' + withReceipts.length + '</span><span class="dash-top-label">Receipts (' + monthLabel + ')</span></div>' +
      '<div class="dash-top-item"><div class="dash-top-icon">💰</div><span class="dash-top-val">' + formatMoney(totalAmount) + '</span><span class="dash-top-label">Total Amount</span></div>' +
      '<div class="dash-top-item"><div class="dash-top-icon">📂</div><span class="dash-top-val">' + Object.keys(byCategory).length + '</span><span class="dash-top-label">Categories</span></div>' +
      '<div class="dash-top-item"><div class="dash-top-icon">📊</div><span class="dash-top-val">' + all.length + '</span><span class="dash-top-label">Total Expenses</span></div>' +
    '</div>';

    // Grid
    if (!withReceipts.length) {
      grid.innerHTML = '<div class="card" style="text-align:center;padding:2rem;grid-column:1/-1;color:#78716c"><div style="font-size:2rem;margin-bottom:0.5rem">🧾</div>No receipts for ' + monthLabel + '</div>';
      return;
    }

    grid.innerHTML = withReceipts.map(function(e) {
      return '<div class="card" style="padding:0;overflow:hidden;cursor:pointer" onclick="showReceiptDetail(' + e.id + ')">' +
        '<div style="height:140px;background:#f5f5f4;display:flex;align-items:center;justify-content:center;overflow:hidden">' +
          '<img src="/api/expenses/' + e.id + '/receipt" style="max-width:100%;max-height:140px;object-fit:cover" loading="lazy" onerror="this.parentElement.innerHTML=\'<div style=text-align:center;color:#a8a29e;font-size:2rem>🧾</div>\'">' +
        '</div>' +
        '<div style="padding:0.6rem">' +
          '<div style="font-weight:700;font-size:0.85rem;margin-bottom:0.2rem">' + escapeHtml(e.vendor || 'Unknown') + '</div>' +
          '<div style="display:flex;justify-content:space-between;font-size:0.78rem">' +
            '<span class="badge badge-gray" style="font-size:0.6rem">' + escapeHtml(e.category) + '</span>' +
            '<strong style="color:#166534">' + formatMoney(e.amount) + '</strong>' +
          '</div>' +
          '<div style="font-size:0.72rem;color:var(--gray-400);margin-top:0.2rem">' + formatDate(e.expense_date) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (err) {
    grid.innerHTML = '<div class="card" style="color:#dc2626;grid-column:1/-1">Failed to load receipts</div>';
  }
}

async function showReceiptDetail(id) {
  try {
    var list = await API.get('/expenses');
    var e = (list || []).find(function(x) { return x.id === id; });
    if (!e) return;

    showModal('🧾 Receipt — ' + escapeHtml(e.vendor || 'Unknown'),
      '<div style="display:flex;gap:1rem;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:200px">' +
          '<img src="/api/expenses/' + e.id + '/receipt" style="max-width:100%;border-radius:8px;border:1px solid var(--gray-200)" onerror="this.style.display=\'none\'">' +
        '</div>' +
        '<div style="flex:1;min-width:200px">' +
          '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Date</label><div style="font-weight:700">' + formatDate(e.expense_date) + '</div></div>' +
          '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Vendor</label><div style="font-weight:700">' + escapeHtml(e.vendor || '—') + '</div></div>' +
          '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Category</label><div><span class="badge badge-info">' + escapeHtml(e.category) + '</span></div></div>' +
          '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Amount</label><div style="font-weight:800;font-size:1.2rem;color:#166534">' + formatMoney(e.amount) + '</div></div>' +
          '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Description</label><div>' + escapeHtml(e.description || '—') + '</div></div>' +
          '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Paid By</label><div>' + escapeHtml(e.paid_by || '—') + '</div></div>' +
          (e.status ? '<div class="form-group"><label style="font-size:0.78rem;color:var(--gray-500)">Status</label><div>' + (e.status === 'filed' ? '<span class="badge badge-success">✅ Filed</span>' : '<span class="badge badge-warning">⏳ ' + escapeHtml(e.status) + '</span>') + '</div></div>' : '') +
        '</div>' +
      '</div>'
    );
  } catch (err) {
    alert('Error: ' + (err.message || 'Unknown'));
  }
}
