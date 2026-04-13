/*
 * Anahuac RV Park — Expense Tracking
 */
var EXP_CATS = ['Repairs','Utilities','Supplies','Insurance','Legal','Equipment','Landscaping','Fuel','Office','Other'];

async function loadExpenses() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  var today = new Date().toISOString().split('T')[0];
  var summary = await API.get('/expenses/summary');

  document.getElementById('page-content').innerHTML =
    helpPanel('expenses') +
    '<div class="page-header"><h2>💸 Expenses</h2>' +
    '<button class="btn btn-primary" id="btn-add-expense">+ Add Expense</button></div>' +

    '<div class="dash-top-bar" style="margin-bottom:1rem">' +
      '<div class="dash-top-item dash-border-red"><div class="dash-top-icon">💸</div><span class="dash-top-val">' + formatMoney(summary?.total || 0) + '</span><span class="dash-top-label">This Month</span></div>' +
      (summary?.byCategory || []).slice(0, 3).map(function(c) {
        return '<div class="dash-top-item"><div class="dash-top-icon">📊</div><span class="dash-top-val">' + formatMoney(c.total) + '</span><span class="dash-top-label">' + escapeHtml(c.category) + '</span></div>';
      }).join('') +
    '</div>' +

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
    var addBtn = document.getElementById('btn-add-expense');
    if (addBtn) addBtn.addEventListener('click', showAddExpense);
    var filterBtn = document.getElementById('btn-filter-exp');
    if (filterBtn) filterBtn.addEventListener('click', refreshExpList);
  }, 50);

  refreshExpList();
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
    if (!list || !list.length) { el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">No expenses found</div>'; return; }
    var total = list.reduce(function(s, e) { return s + (Number(e.amount) || 0); }, 0);
    el.innerHTML = '<div class="card"><div class="table-container"><table>' +
      '<thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Amount</th><th>Actions</th></tr></thead><tbody>' +
      list.map(function(e) {
        return '<tr><td>' + formatDate(e.expense_date) + '</td><td><span class="badge badge-gray" style="font-size:0.65rem">' + escapeHtml(e.category) + '</span></td>' +
          '<td>' + escapeHtml(e.description || '') + '</td><td>' + escapeHtml(e.vendor || '—') + '</td>' +
          '<td><strong>' + formatMoney(e.amount) + '</strong></td>' +
          '<td><button class="btn btn-sm btn-danger" onclick="deleteExpense(' + e.id + ')">Del</button></td></tr>';
      }).join('') +
      '<tr style="border-top:2px solid var(--gray-900)"><td colspan="4"><strong>Total</strong></td><td><strong>' + formatMoney(total) + '</strong></td><td></td></tr>' +
      '</tbody></table></div></div>';
  } catch { el.innerHTML = '<div class="card" style="color:#dc2626">Failed to load</div>'; }
}

function showAddExpense() {
  var today = new Date().toISOString().split('T')[0];
  showModal('+ Add Expense',
    '<form id="expense-form">' +
    '<div class="form-row"><div class="form-group"><label>Date</label><input name="expense_date" type="date" value="' + today + '" required></div>' +
    '<div class="form-group"><label>Amount ($)</label><input name="amount" type="number" step="0.01" required></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Category</label><select name="category">' +
      EXP_CATS.map(function(c) { return '<option>' + c + '</option>'; }).join('') +
    '</select></div><div class="form-group"><label>Vendor</label><input name="vendor" placeholder="e.g. Home Depot"></div></div>' +
    '<div class="form-group"><label>Description</label><input name="description" placeholder="What was purchased/paid for"></div>' +
    '<div class="form-group"><label>Paid By</label><input name="paid_by" placeholder="Cash, Card, Check..."></div>' +
    '<button type="submit" class="btn btn-primary btn-full">Save Expense</button></form>'
  );
  setTimeout(function() {
    var form = document.getElementById('expense-form');
    if (form) form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var data = Object.fromEntries(new FormData(e.target));
      data.amount = parseFloat(data.amount) || 0;
      await API.post('/expenses', data);
      closeModal();
      showStatusToast('✅', 'Expense saved');
      loadExpenses();
    });
  }, 50);
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  await API.del('/expenses/' + id);
  refreshExpList();
}
