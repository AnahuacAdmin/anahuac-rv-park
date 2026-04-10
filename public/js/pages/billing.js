async function loadBilling() {
  const showDeleted = window._showDeletedInvoices === true;
  const invoices = await API.get('/invoices' + (showDeleted ? '?includeDeleted=1' : ''));
  if (!invoices) return;

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('billing')}
    <div class="page-header">
      <h2>Billing & Invoices</h2>
      <div class="btn-group">
        <button class="btn btn-success" onclick="showGenerateInvoices()">Generate Monthly Invoices</button>
        <button class="btn btn-danger" onclick="checkLateFees()">Check Late Fees</button>
        <button class="btn btn-warning" onclick="sendUnpaidPaymentReminders()">Send Payment Reminder (SMS)</button>
        <button class="btn btn-warning" onclick="showTaxReport()">Tax Reports</button>
        <button class="btn btn-outline" onclick="exportInvoicesToExcel()">Export to Excel</button>
        <button class="btn btn-primary" onclick="showCreateInvoice()">+ Single Invoice</button>
      </div>
    </div>
    <div class="filter-bar">
      <select id="invoice-status-filter" onchange="applyInvoiceFilters()">
        <option value="all">All Statuses</option>
        <option value="pending">Pending</option>
        <option value="partial">Partial</option>
        <option value="paid">Paid</option>
      </select>
      <select id="invoice-month-filter" onchange="applyInvoiceFilters()">
        <option value="all">All Months</option>
        ${[...Array(12)].map((_, i) => `<option value="${i + 1}">${new Date(2000, i).toLocaleString('default', { month: 'long' })}</option>`).join('')}
      </select>
      <select id="invoice-year-filter" onchange="applyInvoiceFilters()">
        <option value="all">All Years</option>
        ${invoiceYearOptions(invoices)}
      </select>
      <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.9rem;cursor:pointer">
        <input type="checkbox" id="invoice-show-deleted" ${showDeleted ? 'checked' : ''} onchange="toggleShowDeleted(this.checked)">
        Show Deleted
      </label>
    </div>
    <div class="card">
      <div class="table-container table-scroll billing-scroll">
        <table class="billing-table">
          <thead><tr><th>Invoice #</th><th>Lot</th><th>Tenant</th><th>Date</th><th>Rent</th><th>Electric</th><th>Mailbox</th><th>Misc</th><th>Late Fee</th><th>Refund</th><th>Notes</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="invoices-body">
            ${renderInvoiceRows(invoices)}
          </tbody>
        </table>
      </div>
    </div>
  `;
  window._allInvoices = invoices;
}

function renderInvoiceRows(invoices) {
  if (!invoices.length) return '<tr><td colspan="16" class="text-center">No invoices yet. Generate monthly invoices to get started.</td></tr>';
  return invoices.map(inv => renderInvoiceRow(inv)).join('');
}

function toggleShowDeleted(checked) {
  window._showDeletedInvoices = checked;
  loadBilling();
}

function renderInvoiceRow(inv) {
  if (inv.deleted) return renderDeletedInvoiceRow(inv);
  return `
    <tr class="invoice-row" data-status="${inv.status}" data-id="${inv.id}">
      <td>${inv.invoice_number}</td>
      <td><strong>${inv.lot_id}</strong></td>
      <td>${inv.first_name} ${inv.last_name}</td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td>${formatMoney(inv.rent_amount)}</td>
      <td>${formatMoney(inv.electric_amount)}</td>
      ${editableMoneyCell(inv.id, 'mailbox_fee', inv.mailbox_fee)}
      ${editableMoneyCell(inv.id, 'misc_fee', inv.misc_fee, inv.misc_description)}
      ${editableMoneyCell(inv.id, 'late_fee', inv.late_fee)}
      ${editableMoneyCell(inv.id, 'refund_amount', inv.refund_amount, inv.refund_description, true)}
      ${editableTextCell(inv.id, 'notes', inv.notes)}
      <td><strong>${formatMoney(inv.total_amount)}</strong></td>
      <td>${formatMoney(inv.amount_paid)}</td>
      <td><strong>${formatMoney(inv.balance_due)}</strong></td>
      <td><span class="badge badge-${inv.status === 'paid' ? 'success' : inv.status === 'partial' ? 'warning' : 'danger'}">${inv.status}</span></td>
      <td class="btn-group">
        <button class="btn btn-sm btn-outline" onclick="viewInvoice(${inv.id})">View</button>
        <button class="btn btn-sm btn-outline" onclick="downloadInvoicePdf(${inv.id})">PDF</button>
        <button class="btn btn-sm btn-outline" onclick="emailInvoice(${inv.id})">Email</button>
        <button class="btn btn-sm btn-outline" onclick="smsInvoice(${inv.id})">SMS</button>
        ${inv.balance_due > 0.005 ? `<button class="btn btn-sm btn-success" onclick="payInvoiceWithStripe(${inv.id})">Pay Now</button>` : ''}
        <button class="btn btn-sm btn-primary" onclick="editInvoice(${inv.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteInvoice(${inv.id})">Del</button>
      </td>
    </tr>
  `;
}

function renderDeletedInvoiceRow(inv) {
  return `
    <tr class="invoice-row deleted-row" data-id="${inv.id}" style="color:#9ca3af;background:#f3f4f6;font-style:italic">
      <td>${inv.invoice_number}</td>
      <td>${inv.lot_id}</td>
      <td>${inv.first_name} ${inv.last_name}</td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td>${formatMoney(inv.rent_amount)}</td>
      <td>${formatMoney(inv.electric_amount)}</td>
      <td>${formatMoney(inv.mailbox_fee)}</td>
      <td>${formatMoney(inv.misc_fee)}</td>
      <td>${formatMoney(inv.late_fee)}</td>
      <td>${inv.refund_amount ? '-' + formatMoney(inv.refund_amount) : formatMoney(0)}</td>
      <td>${inv.notes || ''}</td>
      <td>${formatMoney(inv.total_amount)}</td>
      <td>${formatMoney(inv.amount_paid)}</td>
      <td>${formatMoney(inv.balance_due)}</td>
      <td><span class="badge badge-gray">deleted</span></td>
      <td><button class="btn btn-sm btn-success" onclick="restoreInvoice(${inv.id})">Restore</button></td>
    </tr>
  `;
}

async function restoreInvoice(id) {
  if (!confirm('Restore this invoice?')) return;
  try {
    await API.post(`/invoices/${id}/restore`, {});
    loadBilling();
  } catch (err) {
    alert('Restore failed: ' + (err.message || 'unknown error'));
  }
}

function editableMoneyCell(id, field, value, description, negative) {
  const display = negative && value
    ? '-' + formatMoney(value)
    : formatMoney(value);
  const desc = description ? ` <small>(${escapeHtmlBilling(description)})</small>` : '';
  return `<td class="editable-cell" data-id="${id}" data-field="${field}" data-type="money" data-value="${value || 0}">
    <span class="editable-display">${display}${desc}</span><span class="edit-pencil">&#9998;</span>
  </td>`;
}

function editableTextCell(id, field, value) {
  const display = value ? escapeHtmlBilling(value) : '<span class="muted">—</span>';
  return `<td class="editable-cell editable-text" data-id="${id}" data-field="${field}" data-type="text" data-value="${escapeAttrBilling(value || '')}">
    <span class="editable-display">${display}</span><span class="edit-pencil">&#9998;</span>
  </td>`;
}

function escapeHtmlBilling(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttrBilling(s) { return escapeHtmlBilling(s); }

// Click → swap cell to input. Enter or blur → save via PATCH and update row.
document.addEventListener('click', async (e) => {
  const cell = e.target.closest('.editable-cell');
  if (!cell || cell.classList.contains('editing')) return;
  // Avoid stealing clicks from buttons inside other cells
  if (e.target.closest('button')) return;
  startInlineEdit(cell);
});

function startInlineEdit(cell) {
  cell.classList.add('editing');
  const type = cell.dataset.type;
  const value = cell.dataset.value;
  const original = cell.innerHTML;
  const input = document.createElement('input');
  input.type = type === 'money' ? 'number' : 'text';
  if (type === 'money') input.step = '0.01';
  input.value = value;
  input.className = 'inline-edit-input';
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  let saving = false;
  const cancel = () => { cell.innerHTML = original; cell.classList.remove('editing'); };
  const commit = async () => {
    if (saving) return;
    saving = true;
    const newValRaw = input.value;
    const newVal = type === 'money' ? (parseFloat(newValRaw) || 0) : newValRaw;
    if (String(newVal) === String(value)) { cancel(); return; }
    try {
      const updated = await API.patch(`/invoices/${cell.dataset.id}`, { [cell.dataset.field]: newVal });
      // Merge into _allInvoices and re-render this row in place
      const idx = window._allInvoices.findIndex(i => i.id === updated.id);
      if (idx >= 0) {
        window._allInvoices[idx] = { ...window._allInvoices[idx], ...updated };
        const tr = cell.closest('tr');
        const replacement = document.createElement('tbody');
        replacement.innerHTML = renderInvoiceRow(window._allInvoices[idx]);
        tr.replaceWith(replacement.firstElementChild);
      }
    } catch (err) {
      alert('Save failed: ' + err.message);
      cancel();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

function invoiceYearOptions(invoices) {
  const years = [...new Set(invoices.map(i => (i.invoice_date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  if (!years.length) years.push(String(new Date().getFullYear()));
  return years.map(y => `<option value="${y}">${y}</option>`).join('');
}

function applyInvoiceFilters() {
  if (!window._allInvoices) return;
  const status = document.getElementById('invoice-status-filter').value;
  const month  = document.getElementById('invoice-month-filter').value;
  const year   = document.getElementById('invoice-year-filter').value;
  const filtered = window._allInvoices.filter(i => {
    if (status !== 'all' && i.status !== status) return false;
    const d = i.invoice_date || '';
    if (year !== 'all' && d.slice(0, 4) !== year) return false;
    if (month !== 'all' && parseInt(d.slice(5, 7)) !== parseInt(month)) return false;
    return true;
  });
  document.getElementById('invoices-body').innerHTML = renderInvoiceRows(filtered);
}

// Backwards-compatible alias in case anything else still calls it.
function filterInvoices(status) {
  const sel = document.getElementById('invoice-status-filter');
  if (sel) sel.value = status;
  applyInvoiceFilters();
}

function showGenerateInvoices() {
  const now = new Date();
  showModal('Generate Monthly Invoices', `
    <form onsubmit="generateInvoices(event)">
      <p>This will generate invoices for all active tenants based on their rent and latest meter readings.</p>
      <div class="form-row">
        <div class="form-group">
          <label>Billing Month</label>
          <select name="billing_month">
            ${[...Array(12)].map((_, i) => `<option value="${i + 1}" ${i + 1 === now.getMonth() + 1 ? 'selected' : ''}>${new Date(2026, i).toLocaleString('default', { month: 'long' })}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Billing Year</label>
          <input name="billing_year" type="number" value="${now.getFullYear()}" required>
        </div>
      </div>
      <button type="submit" class="btn btn-success btn-full mt-2">Generate Invoices</button>
    </form>
  `);
}

async function generateInvoices(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const result = await API.post('/invoices/generate', {
    billing_month: parseInt(form.get('billing_month')),
    billing_year: parseInt(form.get('billing_year'))
  });
  closeModal();
  alert(`Generated ${result.generated} invoices for lots: ${result.lots.join(', ') || 'none (already generated)'}`);
  loadBilling();
}

async function showCreateInvoice() {
  const tenants = await API.get('/tenants');
  showModal('Create Invoice', `
    <form onsubmit="createInvoice(event)">
      <div class="form-group">
        <label>Tenant</label>
        <select name="tenant_id" required>
          <option value="">Select tenant...</option>
          ${tenants.map(t => `<option value="${t.id}">${t.lot_id} - ${t.first_name} ${t.last_name}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Invoice Date</label><input name="invoice_date" type="date" value="${new Date().toISOString().split('T')[0]}" required></div>
        <div class="form-group"><label>Due Date</label><input name="due_date" type="date" value="${new Date().toISOString().split('T')[0]}" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Rent Amount</label><input name="rent_amount" type="number" step="0.01" value="295"></div>
        <div class="form-group"><label>Electric Amount</label><input name="electric_amount" type="number" step="0.01" value="0"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Other Charges</label><input name="other_charges" type="number" step="0.01" value="0"></div>
        <div class="form-group"><label>Late Fee</label><input name="late_fee" type="number" step="0.01" value="0"></div>
      </div>
      <div class="form-group"><label>Other Description</label><input name="other_description"></div>
      <div class="form-row">
        <div class="form-group"><label>Mailbox Fee</label><input name="mailbox_fee" type="number" step="0.01" value="0"></div>
        <div class="form-group"><label>Misc Fee</label><input name="misc_fee" type="number" step="0.01" value="0"></div>
      </div>
      <div class="form-group"><label>Misc Description</label><input name="misc_description"></div>
      <div class="form-row">
        <div class="form-group"><label>Refund / Credit</label><input name="refund_amount" type="number" step="0.01" value="0"></div>
        <div class="form-group"><label>Refund Description</label><input name="refund_description"></div>
      </div>
      <div class="form-group"><label>Notes</label><textarea name="notes"></textarea></div>
      <button type="submit" class="btn btn-primary btn-full mt-2">Create Invoice</button>
      <p id="create-invoice-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

async function createInvoice(e) {
  e.preventDefault();
  const errEl = document.getElementById('create-invoice-error');
  if (errEl) errEl.style.display = 'none';
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);
  if (!data.tenant_id) {
    if (errEl) { errEl.textContent = 'Please select a tenant.'; errEl.style.display = ''; }
    return;
  }
  if (!data.invoice_date || !data.due_date) {
    if (errEl) { errEl.textContent = 'Invoice date and due date are required.'; errEl.style.display = ''; }
    return;
  }
  data.tenant_id = parseInt(data.tenant_id);
  ['rent_amount','electric_amount','other_charges','late_fee','mailbox_fee','misc_fee','refund_amount']
    .forEach(k => data[k] = parseFloat(data[k]) || 0);
  try {
    await API.post('/invoices', data);
    closeModal();
    loadBilling();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || 'Failed to create invoice.';
      errEl.style.display = '';
    } else {
      alert('Failed to create invoice: ' + (err.message || 'unknown error'));
    }
  }
}

async function viewInvoice(id) {
  const inv = await API.get(`/invoices/${id}`);
  if (!inv) return;

  showModal('Invoice ' + inv.invoice_number, `
    <div class="invoice-print" id="printable-invoice">
      <div class="invoice-header">
        <div style="display:flex;align-items:center;gap:1rem">
          <img src="/park_Logo.png" alt="Anahuac RV Park" style="height:100px;width:auto">
          <div>
            <h2>Anahuac RV Park, LLC</h2>
            <p>1003 Davis Ave, Anahuac, TX 77514</p>
            <p>409-267-6603</p>
          </div>
        </div>
        <div style="text-align:right">
          <h3>INVOICE</h3>
          <p><strong>${inv.invoice_number}</strong></p>
          <p>Date: ${formatDate(inv.invoice_date)}</p>
        </div>
      </div>
      <div style="margin-bottom:1.5rem">
        <p><strong>Bill To:</strong></p>
        <p>${inv.first_name} ${inv.last_name}</p>
        <p>Lot ${inv.lot_id}</p>
        ${inv.phone ? `<p>${inv.phone}</p>` : ''}
      </div>
      <div class="line-items">
        <table>
          <thead><tr><th>Description</th><th class="text-right">Amount</th></tr></thead>
          <tbody>
            <tr><td>Monthly Rent</td><td class="text-right">${formatMoney(inv.rent_amount)}</td></tr>
            ${meterRowsHtml(inv)}
            ${inv.other_charges ? `<tr><td>${inv.other_description || 'Other Charges'}</td><td class="text-right">${formatMoney(inv.other_charges)}</td></tr>` : ''}
            ${inv.mailbox_fee ? `<tr><td>Mailbox Fee</td><td class="text-right">${formatMoney(inv.mailbox_fee)}</td></tr>` : ''}
            ${inv.misc_fee ? `<tr><td>${inv.misc_description || 'Misc Fee'}</td><td class="text-right">${formatMoney(inv.misc_fee)}</td></tr>` : ''}
            ${inv.late_fee ? `<tr><td>Late Fee</td><td class="text-right">${formatMoney(inv.late_fee)}</td></tr>` : ''}
            ${inv.refund_amount ? `<tr><td>${inv.refund_description || 'Refund / Credit'}</td><td class="text-right">-${formatMoney(inv.refund_amount)}</td></tr>` : ''}
            <tr class="total-row"><td><strong>Total</strong></td><td class="text-right"><strong>${formatMoney(inv.total_amount)}</strong></td></tr>
            <tr><td>Amount Paid</td><td class="text-right">${formatMoney(inv.amount_paid)}</td></tr>
            <tr class="total-row"><td><strong>Balance Due</strong></td><td class="text-right"><strong>${formatMoney(inv.balance_due)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      ${inv.notes ? `<p><strong>Notes:</strong> ${inv.notes}</p>` : ''}
      ${invoiceStandardNotesHtml()}
      ${inv.payments?.length ? `
        <h4 class="mt-2">Payment History</h4>
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead>
          <tbody>${inv.payments.map(p => `<tr><td>${formatDate(p.payment_date)}</td><td>${formatMoney(p.amount)}</td><td>${p.payment_method || '—'}</td></tr>`).join('')}</tbody>
        </table>
      ` : ''}
    </div>
    ${inv.balance_due > 0.005 ? `
    <div class="no-print mt-2" style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:0.75rem 1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <strong style="color:#92400e">Pay Online</strong>
        <p style="font-size:0.85rem;color:#78350f;margin:0.2rem 0 0">Note: A 3% convenience fee applies to all credit/debit card payments.</p>
      </div>
      <button class="btn btn-success" onclick="payInvoiceWithStripe(${inv.id})">Pay Now ($${(Number(inv.balance_due) * 1.03).toFixed(2)} incl. fee)</button>
    </div>
    ` : ''}
    <div class="no-print mt-2 btn-group">
      <button class="btn btn-primary" onclick="window.print()">Print Invoice</button>
      <button class="btn btn-outline" onclick="downloadInvoicePdfFromView('${inv.invoice_number}')">Download PDF</button>
      <button class="btn btn-outline" onclick="emailInvoice(${inv.id})">Email Invoice</button>
    </div>
  `);
}

// Render the meter / electric line items shown on both the view modal and the PDF.
// Format matches:
//   Previous Reading: 57336
//   Current Reading:  57884
//   kWh Used:         548
//   Electric Charge (548 kWh x $0.15) = $82.20
function meterRowsHtml(inv) {
  const fmtNum = (v) => Number(v ?? 0).toLocaleString();
  // Multi-meter mode (mid-month move): render one block per lot reading.
  if (Array.isArray(inv.meters) && inv.meters.length > 1) {
    return inv.meters.map(m => {
      const rate = Number(m.rate_per_kwh).toFixed(2);
      return `
        <tr><td colspan="2"><strong>Electric — Lot ${m.lot_id}</strong>${m.notes ? ` <small>(${m.notes})</small>` : ''}</td></tr>
        <tr><td>&nbsp;&nbsp;Previous Reading</td><td class="text-right">${fmtNum(m.previous_reading)}</td></tr>
        <tr><td>&nbsp;&nbsp;Current Reading</td><td class="text-right">${fmtNum(m.current_reading)}</td></tr>
        <tr><td>&nbsp;&nbsp;kWh Used</td><td class="text-right">${fmtNum(m.kwh_used)}</td></tr>
        <tr><td>&nbsp;&nbsp;Electric Charge (${fmtNum(m.kwh_used)} kWh &times; $${rate})</td><td class="text-right">${formatMoney(m.electric_charge)}</td></tr>
      `;
    }).join('');
  }
  // Single-meter mode (existing behavior).
  if (!inv.meter) {
    return `<tr><td>Electric Charges</td><td class="text-right">${formatMoney(inv.electric_amount)}</td></tr>`;
  }
  const m = inv.meter;
  const rate = Number(m.rate_per_kwh).toFixed(2);
  return `
    <tr><td>Previous Reading</td><td class="text-right">${fmtNum(m.previous_reading)}</td></tr>
    <tr><td>Current Reading</td><td class="text-right">${fmtNum(m.current_reading)}</td></tr>
    <tr><td>kWh Used</td><td class="text-right">${fmtNum(m.kwh_used)}</td></tr>
    <tr><td>Electric Charge (${fmtNum(m.kwh_used)} kWh &times; $${rate})</td><td class="text-right">${formatMoney(inv.electric_amount)}</td></tr>
  `;
}

// --- PDF generation via html2pdf.js (jsPDF + html2canvas) ---
function _pdfOptions(invoiceNumber) {
  return {
    margin:       [0.4, 0.4, 0.5, 0.4],
    filename:     `Invoice-${invoiceNumber}.pdf`,
    image:        { type: 'jpeg', quality: 0.95 },
    html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' },
    pagebreak:    { mode: ['css', 'legacy'] },
  };
}

async function downloadInvoicePdfFromView(invoiceNumber) {
  const el = document.getElementById('printable-invoice');
  if (!el) return;
  await html2pdf().set(_pdfOptions(invoiceNumber)).from(el).save();
}

// Generate PDF without opening the modal — fetches the invoice and renders off-screen.
async function downloadInvoicePdf(id) {
  const inv = await API.get(`/invoices/${id}`);
  if (!inv) return;
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '-10000px';
  wrap.style.top = '0';
  wrap.style.width = '8.5in';
  wrap.style.background = '#fff';
  wrap.innerHTML = renderInvoiceHtml(inv);
  document.body.appendChild(wrap);
  try {
    await html2pdf().set(_pdfOptions(inv.invoice_number)).from(wrap.firstElementChild).save();
  } finally {
    wrap.remove();
  }
}

// Reusable invoice HTML used by both view modal and offscreen PDF render.
function renderInvoiceHtml(inv) {
  return `
    <div class="invoice-print" id="printable-invoice">
      <div class="invoice-header">
        <div style="display:flex;align-items:center;gap:1rem">
          <img src="/park_Logo.png" alt="Anahuac RV Park" style="height:100px;width:auto" crossorigin="anonymous">
          <div>
            <h2>Anahuac RV Park, LLC</h2>
            <p>1003 Davis Ave, Anahuac, TX 77514</p>
            <p>409-267-6603</p>
          </div>
        </div>
        <div style="text-align:right">
          <h3>INVOICE</h3>
          <p><strong>${inv.invoice_number}</strong></p>
          <p>Date: ${formatDate(inv.invoice_date)}</p>
        </div>
      </div>
      <div style="margin-bottom:1.5rem">
        <p><strong>Bill To:</strong></p>
        <p>${inv.first_name} ${inv.last_name}</p>
        <p>Lot ${inv.lot_id}</p>
        ${inv.phone ? `<p>${inv.phone}</p>` : ''}
      </div>
      <div class="line-items">
        <table>
          <thead><tr><th>Description</th><th class="text-right">Amount</th></tr></thead>
          <tbody>
            <tr><td>Monthly Rent</td><td class="text-right">${formatMoney(inv.rent_amount)}</td></tr>
            ${meterRowsHtml(inv)}
            ${inv.other_charges ? `<tr><td>${inv.other_description || 'Other Charges'}</td><td class="text-right">${formatMoney(inv.other_charges)}</td></tr>` : ''}
            ${inv.mailbox_fee ? `<tr><td>Mailbox Fee</td><td class="text-right">${formatMoney(inv.mailbox_fee)}</td></tr>` : ''}
            ${inv.misc_fee ? `<tr><td>${inv.misc_description || 'Misc Fee'}</td><td class="text-right">${formatMoney(inv.misc_fee)}</td></tr>` : ''}
            ${inv.late_fee ? `<tr><td>Late Fee</td><td class="text-right">${formatMoney(inv.late_fee)}</td></tr>` : ''}
            ${inv.refund_amount ? `<tr><td>${inv.refund_description || 'Refund / Credit'}</td><td class="text-right">-${formatMoney(inv.refund_amount)}</td></tr>` : ''}
            <tr class="total-row"><td><strong>Total</strong></td><td class="text-right"><strong>${formatMoney(inv.total_amount)}</strong></td></tr>
            <tr><td>Amount Paid</td><td class="text-right">${formatMoney(inv.amount_paid)}</td></tr>
            <tr class="total-row"><td><strong>Balance Due</strong></td><td class="text-right"><strong>${formatMoney(inv.balance_due)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      ${inv.notes ? `<p><strong>Notes:</strong> ${inv.notes}</p>` : ''}
      ${invoiceStandardNotesHtml()}
    </div>
  `;
}

function invoiceStandardNotesHtml() {
  return `
    <div class="invoice-standard-notes" style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #ccc;font-size:0.85rem;line-height:1.5;color:#374151">
      <p>We would appreciate it if you could make arrangements to complete payment as soon as possible.</p>
      <p>If payment is not received within 3 days from the date of this invoice a $25.00 fee will be applied.</p>
      <p>If payment is not received within 5 days of this invoice, an eviction notice will be served.</p>
      <p>Please do not hesitate to call us if you have any questions about the balance due on your account. If you have already sent us your payment, please disregard.</p>
      <ul style="margin:0.75rem 0 0.75rem 1.25rem;padding:0">
        <li>Please pay by debit/credit card or deliver payment into night deposit box located at the front of the warehouse, if we are not available to receive payment by phone.</li>
        <li>If paying with credit card a 3% charge will be applied.</li>
      </ul>
      <p>Thank you very much for your attention to this matter and your continued business. We sincerely appreciate your business and hope you have a blessed day!</p>
    </div>
  `;
}

// Email Invoice — generates the PDF in the browser (html2pdf), then sends it
// to the backend as base64 so nodemailer can attach it and send via Gmail.
async function emailInvoice(id) {
  const inv = await API.get(`/invoices/${id}`);
  if (!inv) return;
  if (!inv.email) {
    alert('No email address on file for this tenant. Add one on the Tenants page first.');
    return;
  }
  if (!confirm(`Send invoice ${inv.invoice_number} to ${inv.email}?`)) return;

  // Render the invoice HTML offscreen and convert to a PDF Blob, then to base64.
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '-10000px';
  wrap.style.top = '0';
  wrap.style.width = '8.5in';
  wrap.style.background = '#fff';
  wrap.innerHTML = renderInvoiceHtml(inv);
  document.body.appendChild(wrap);

  try {
    const pdfBlob = await html2pdf()
      .set(_pdfOptions(inv.invoice_number))
      .from(wrap.firstElementChild)
      .outputPdf('blob');
    const pdfBase64 = await blobToBase64(pdfBlob);

    const result = await API.post(`/invoices/${id}/email`, { pdfBase64 });
    if (result?.success) {
      alert(`Invoice emailed to ${result.sentTo}.`);
    } else {
      alert('Email request completed but the server did not confirm success.');
    }
  } catch (err) {
    alert('Failed to send email: ' + (err.message || 'unknown error'));
  } finally {
    wrap.remove();
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // reader.result is "data:application/pdf;base64,XXXX..." — strip the prefix
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function editInvoice(id) {
  const inv = await API.get(`/invoices/${id}`);
  if (!inv) return;
  showModal(`Edit Invoice ${inv.invoice_number}`, `
    <form onsubmit="saveInvoiceEdit(event, ${id})">
      <div class="form-row">
        <div class="form-group"><label>Rent</label><input name="rent_amount" type="number" step="0.01" value="${inv.rent_amount || 0}"></div>
        <div class="form-group"><label>Electric</label><input name="electric_amount" type="number" step="0.01" value="${inv.electric_amount || 0}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Late Fee</label><input name="late_fee" type="number" step="0.01" value="${inv.late_fee || 0}"></div>
        <div class="form-group"><label>Mailbox Fee</label><input name="mailbox_fee" type="number" step="0.01" value="${inv.mailbox_fee || 0}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Misc Fee</label><input name="misc_fee" type="number" step="0.01" value="${inv.misc_fee || 0}"></div>
        <div class="form-group"><label>Misc Description</label><input name="misc_description" value="${inv.misc_description || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Refund / Credit</label><input name="refund_amount" type="number" step="0.01" value="${inv.refund_amount || 0}"></div>
        <div class="form-group"><label>Refund Description</label><input name="refund_description" value="${inv.refund_description || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Other Charges</label><input name="other_charges" type="number" step="0.01" value="${inv.other_charges || 0}"></div>
        <div class="form-group"><label>Other Description</label><input name="other_description" value="${inv.other_description || ''}"></div>
      </div>
      <div class="form-group"><label>Status</label>
        <select name="status">
          <option value="pending" ${inv.status==='pending'?'selected':''}>Pending</option>
          <option value="partial" ${inv.status==='partial'?'selected':''}>Partial</option>
          <option value="paid" ${inv.status==='paid'?'selected':''}>Paid</option>
        </select>
      </div>
      <div class="form-group"><label>Notes</label><textarea name="notes">${inv.notes || ''}</textarea></div>
      <fieldset style="border:1px solid #ddd;padding:0.5rem;margin:0.5rem 0;border-radius:6px">
        <legend><small>Make Recurring on Tenant</small></legend>
        <p><small>Check any of these to also save the value to the tenant's recurring fees so it auto-applies on future monthly invoices.</small></p>
        <label><input type="checkbox" name="rec_late"> Late Fee</label> &nbsp;
        <label><input type="checkbox" name="rec_mailbox"> Mailbox Fee</label> &nbsp;
        <label><input type="checkbox" name="rec_misc"> Misc Fee + Description</label> &nbsp;
        <label><input type="checkbox" name="rec_refund"> Refund as Recurring Credit</label>
      </fieldset>
      <p><small>Total auto-recalculates: rent + electric + other + mailbox + misc + late − refund</small></p>
      <button type="submit" class="btn btn-primary btn-full mt-2">Save Changes</button>
    </form>
  `);
}

async function saveInvoiceEdit(e, id) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);
  ['rent_amount','electric_amount','other_charges','late_fee','mailbox_fee','misc_fee','refund_amount']
    .forEach(k => data[k] = parseFloat(data[k]) || 0);

  const recFlags = { rec_late: data.rec_late, rec_mailbox: data.rec_mailbox, rec_misc: data.rec_misc, rec_refund: data.rec_refund };
  ['rec_late','rec_mailbox','rec_misc','rec_refund'].forEach(k => delete data[k]);

  await API.put(`/invoices/${id}`, data);

  if (recFlags.rec_late || recFlags.rec_mailbox || recFlags.rec_misc || recFlags.rec_refund) {
    const inv = await API.get(`/invoices/${id}`);
    const tenant = await API.get(`/tenants/${inv.tenant_id}`);
    if (recFlags.rec_late) tenant.recurring_late_fee = data.late_fee;
    if (recFlags.rec_mailbox) tenant.recurring_mailbox_fee = data.mailbox_fee;
    if (recFlags.rec_misc) { tenant.recurring_misc_fee = data.misc_fee; tenant.recurring_misc_description = data.misc_description; }
    if (recFlags.rec_refund) { tenant.recurring_credit = data.refund_amount; tenant.recurring_credit_description = data.refund_description; }
    await API.put(`/tenants/${tenant.id}`, tenant);
  }

  closeModal();
  loadBilling();
}

async function deleteInvoice(id) {
  if (!confirm('Delete this invoice? It will be moved to deleted (recoverable via Show Deleted).')) return;
  // Capture identifying info BEFORE the delete so the toast can show context.
  const inv = window._allInvoices?.find(i => i.id === id);
  const label = inv ? `${inv.invoice_number} (${inv.lot_id})` : `#${id}`;
  try {
    await API.del(`/invoices/${id}`);
    loadBilling();
    showUndoToast(`Invoice ${label} deleted`, async () => {
      try {
        await API.post(`/invoices/${id}/restore`, {});
        loadBilling();
      } catch (err) {
        alert('Restore failed: ' + (err.message || 'unknown error'));
      }
    });
  } catch (err) {
    alert('Delete failed: ' + (err.message || 'unknown error'));
  }
}

// Send a single invoice summary as a Twilio SMS.
async function smsInvoice(id) {
  if (!confirm('Send this invoice summary by SMS to the tenant?')) return;
  try {
    const r = await API.post(`/invoices/${id}/sms`, {});
    alert(`SMS sent to ${r.sentTo}.`);
  } catch (err) {
    alert('SMS failed: ' + (err.message || 'unknown error'));
  }
}

// Text every tenant with an outstanding balance.
async function sendUnpaidPaymentReminders() {
  if (!confirm('Send a payment reminder SMS to every tenant with an outstanding balance?')) return;
  try {
    const r = await API.post('/invoices/sms-unpaid', {});
    let msg = `Payment reminders complete.\n\n`;
    msg += `Unpaid tenants: ${r.totalUnpaid}\n`;
    msg += `Sent: ${r.sent}\n`;
    msg += `Skipped (no phone): ${r.skipped}\n`;
    msg += `Failed: ${r.failed}`;
    if (r.errors?.length) msg += `\n\n` + r.errors.slice(0, 5).join('\n');
    alert(msg);
  } catch (err) {
    alert('Reminder failed: ' + (err.message || 'unknown error'));
  }
}

// Open Stripe Checkout for an invoice. The server creates a session with a 3%
// surcharge line item and returns the hosted URL; we just redirect to it.
async function payInvoiceWithStripe(id) {
  try {
    const r = await API.post('/payments/create-checkout-session', { invoice_id: id });
    if (!r?.url) throw new Error('No checkout URL returned');
    window.location.href = r.url;
  } catch (err) {
    alert('Could not start checkout: ' + (err.message || 'unknown error'));
  }
}

// Bottom-of-screen toast with an Undo action that auto-dismisses after 10s.
function showUndoToast(message, onUndo) {
  // Remove any prior toast so successive deletes replace cleanly.
  document.getElementById('undo-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'undo-toast';
  toast.className = 'undo-toast';
  toast.innerHTML = `
    <span class="undo-toast-msg">${message} — Undo?</span>
    <button type="button" class="undo-toast-btn">Undo</button>
    <button type="button" class="undo-toast-close" aria-label="Dismiss">&times;</button>
    <div class="undo-toast-progress"></div>
  `;
  document.body.appendChild(toast);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 250);
  };

  toast.querySelector('.undo-toast-btn').addEventListener('click', async () => {
    if (dismissed) return;
    dismissed = true;
    toast.remove();
    try { await onUndo(); } catch (e) { alert('Undo failed: ' + (e.message || 'unknown')); }
  });
  toast.querySelector('.undo-toast-close').addEventListener('click', dismiss);

  setTimeout(dismiss, 10000);
}

// Run the late-fee check on demand and show a summary alert.
async function checkLateFees() {
  if (!confirm('Run late fee check now? Any unpaid invoice 3+ days old will get a $25 late fee (only if not already auto-applied).')) return;
  try {
    const r = await API.post('/invoices/check-late-fees', {});
    let msg = `Late fee check complete.\n\n`;
    msg += `Invoices checked: ${r.invoicesChecked}\n`;
    msg += `Late fees applied: ${r.feesApplied} ($${r.feeAmountTotal.toFixed(2)} total)\n`;
    msg += `New eviction warnings: ${r.evictionWarnings}\n`;
    if (r.feeInvoiceNumbers?.length) {
      msg += `\nInvoices charged:\n${r.feeInvoiceNumbers.join('\n')}`;
    }
    alert(msg);
    loadBilling();
  } catch (err) {
    alert('Late fee check failed: ' + (err.message || 'unknown error'));
  }
}

// --- Excel export of currently filtered invoices ---
function exportInvoicesToExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Excel library failed to load. Check your internet connection and try again.');
    return;
  }
  if (!window._allInvoices || !window._allInvoices.length) {
    alert('No invoices to export.');
    return;
  }
  // Use the same filter logic the table uses, so the export matches what's on screen.
  const status = document.getElementById('invoice-status-filter')?.value || 'all';
  const month  = document.getElementById('invoice-month-filter')?.value || 'all';
  const year   = document.getElementById('invoice-year-filter')?.value || 'all';
  const filtered = window._allInvoices.filter(i => {
    if (status !== 'all' && i.status !== status) return false;
    const d = i.invoice_date || '';
    if (year !== 'all' && d.slice(0, 4) !== year) return false;
    if (month !== 'all' && parseInt(d.slice(5, 7)) !== parseInt(month)) return false;
    return true;
  });
  if (!filtered.length) {
    alert('No invoices match the current filters.');
    return;
  }

  const num = (v) => Number(v) || 0;
  const rows = filtered.map(i => ({
    'Invoice #':    i.invoice_number,
    'Lot':          i.lot_id,
    'Tenant':       `${i.first_name || ''} ${i.last_name || ''}`.trim(),
    'Invoice Date': i.invoice_date,
    'Due Date':     i.due_date,
    'Rent':         num(i.rent_amount),
    'Electric':     num(i.electric_amount),
    'Mailbox Fee':  num(i.mailbox_fee),
    'Misc Fee':     num(i.misc_fee),
    'Misc Description': i.misc_description || '',
    'Late Fee':     num(i.late_fee),
    'Other Charges': num(i.other_charges),
    'Other Description': i.other_description || '',
    'Refund / Credit': num(i.refund_amount),
    'Refund Description': i.refund_description || '',
    'Total':        num(i.total_amount),
    'Amount Paid':  num(i.amount_paid),
    'Balance Due':  num(i.balance_due),
    'Status':       i.status,
    'Notes':        i.notes || '',
  }));

  // Totals row
  const sum = (k) => filtered.reduce((s, i) => s + num(i[k]), 0);
  rows.push({});
  rows.push({
    'Invoice #':    'TOTAL',
    'Tenant':       `${filtered.length} invoices`,
    'Rent':         sum('rent_amount'),
    'Electric':     sum('electric_amount'),
    'Mailbox Fee':  sum('mailbox_fee'),
    'Misc Fee':     sum('misc_fee'),
    'Late Fee':     sum('late_fee'),
    'Other Charges': sum('other_charges'),
    'Refund / Credit': sum('refund_amount'),
    'Total':        sum('total_amount'),
    'Amount Paid':  sum('amount_paid'),
    'Balance Due':  sum('balance_due'),
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  // Reasonable column widths
  ws['!cols'] = [
    { wch: 18 }, { wch: 6 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 22 },
    { wch: 10 }, { wch: 10 }, { wch: 22 }, { wch: 12 }, { wch: 22 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 30 },
  ];
  const wb = XLSX.utils.book_new();
  const sheetName = (month !== 'all' && year !== 'all')
    ? `${new Date(2000, parseInt(month) - 1).toLocaleString('default', { month: 'short' })} ${year}`
    : year !== 'all' ? `Year ${year}` : 'All Invoices';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const fileLabel = (month !== 'all' && year !== 'all')
    ? `${year}-${String(month).padStart(2, '0')}`
    : year !== 'all' ? year : 'all';
  XLSX.writeFile(wb, `Anahuac-Invoices-${fileLabel}.xlsx`);
}

// --- Year-end tax / financial report ---
async function showTaxReport() {
  const years = window._allInvoices
    ? [...new Set(window._allInvoices.map(i => (i.invoice_date || '').slice(0, 4)).filter(Boolean))].sort().reverse()
    : [];
  if (!years.length) years.push(String(new Date().getFullYear()));
  showModal('Annual Tax Report', `
    <div class="form-group no-print">
      <label>Year</label>
      <select id="tax-report-year" onchange="renderTaxReport(this.value)">
        ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
      </select>
    </div>
    <div id="tax-report-content"></div>
    <div class="no-print mt-2 btn-group">
      <button class="btn btn-primary" onclick="window.print()">Print Report</button>
      <button class="btn btn-outline" onclick="downloadTaxReportPdf()">Download PDF</button>
    </div>
  `);
  renderTaxReport(years[0]);
}

async function renderTaxReport(year) {
  const data = await API.get(`/invoices/tax-report/${year}`);
  if (!data) return;
  const m = (n) => formatMoney(n);
  const t = data.totals;
  document.getElementById('tax-report-content').innerHTML = `
    <div id="tax-report-printable" class="invoice-print">
      <div class="invoice-header">
        <div style="display:flex;align-items:center;gap:1rem">
          <img src="/park_Logo.png" alt="Anahuac RV Park" style="height:90px;width:auto">
          <div>
            <h2>Anahuac RV Park, LLC</h2>
            <p>1003 Davis Ave, Anahuac, TX 77514</p>
            <p>409-267-6603</p>
          </div>
        </div>
        <div style="text-align:right">
          <h3>ANNUAL TAX REPORT</h3>
          <p><strong>Year ${data.year}</strong></p>
          <p>Generated ${new Date().toLocaleDateString()}</p>
        </div>
      </div>

      <h4 style="margin-top:1rem">Monthly Breakdown</h4>
      <div class="line-items">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th class="text-right">Invoices</th>
              <th class="text-right">Rent</th>
              <th class="text-right">Electric</th>
              <th class="text-right">Mailbox</th>
              <th class="text-right">Misc</th>
              <th class="text-right">Late Fees</th>
              <th class="text-right">Other</th>
              <th class="text-right">Refunds</th>
              <th class="text-right">Total Billed</th>
              <th class="text-right">Collected</th>
            </tr>
          </thead>
          <tbody>
            ${data.months.map(r => `
              <tr>
                <td>${r.label}</td>
                <td class="text-right">${r.invoice_count}</td>
                <td class="text-right">${m(r.rent)}</td>
                <td class="text-right">${m(r.electric)}</td>
                <td class="text-right">${m(r.mailbox)}</td>
                <td class="text-right">${m(r.misc)}</td>
                <td class="text-right">${m(r.late_fee)}</td>
                <td class="text-right">${m(r.other)}</td>
                <td class="text-right">${r.refunds ? '-' + m(r.refunds) : m(0)}</td>
                <td class="text-right"><strong>${m(r.billed)}</strong></td>
                <td class="text-right"><strong>${m(r.collected)}</strong></td>
              </tr>
            `).join('')}
            <tr class="total-row">
              <td><strong>YEAR TOTAL</strong></td>
              <td class="text-right"><strong>${t.invoice_count}</strong></td>
              <td class="text-right"><strong>${m(t.rent)}</strong></td>
              <td class="text-right"><strong>${m(t.electric)}</strong></td>
              <td class="text-right"><strong>${m(t.mailbox)}</strong></td>
              <td class="text-right"><strong>${m(t.misc)}</strong></td>
              <td class="text-right"><strong>${m(t.late_fee)}</strong></td>
              <td class="text-right"><strong>${m(t.other)}</strong></td>
              <td class="text-right"><strong>${t.refunds ? '-' + m(t.refunds) : m(0)}</strong></td>
              <td class="text-right"><strong>${m(t.billed)}</strong></td>
              <td class="text-right"><strong>${m(t.collected)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4 style="margin-top:1.5rem">Annual Summary</h4>
      <div class="line-items">
        <table>
          <tbody>
            <tr><td>Total Rent Collected (billed)</td><td class="text-right">${m(t.rent)}</td></tr>
            <tr><td>Total Electric Revenue</td><td class="text-right">${m(t.electric)}</td></tr>
            <tr><td>Total Mailbox Fees</td><td class="text-right">${m(t.mailbox)}</td></tr>
            <tr><td>Total Misc Fees</td><td class="text-right">${m(t.misc)}</td></tr>
            <tr><td>Total Late Fees</td><td class="text-right">${m(t.late_fee)}</td></tr>
            <tr><td>Total Other Charges</td><td class="text-right">${m(t.other)}</td></tr>
            <tr><td>Total Refunds / Credits Given</td><td class="text-right">-${m(t.refunds)}</td></tr>
            <tr class="total-row"><td><strong>Grand Total Billed</strong></td><td class="text-right"><strong>${m(t.billed)}</strong></td></tr>
            <tr class="total-row"><td><strong>Grand Total Collected (Payments)</strong></td><td class="text-right"><strong>${m(t.collected)}</strong></td></tr>
          </tbody>
        </table>
      </div>

      <p style="margin-top:1.5rem;font-size:0.85rem;color:#555">
        Report generated from invoice and payment records on file. "Total Billed" reflects amounts on issued invoices for ${data.year}; "Total Collected" reflects payments received during ${data.year}.
      </p>
    </div>
  `;
}

async function downloadTaxReportPdf() {
  const el = document.getElementById('tax-report-printable');
  if (!el) return;
  const year = document.getElementById('tax-report-year')?.value || new Date().getFullYear();
  await html2pdf().set({
    margin:      [0.4, 0.4, 0.5, 0.4],
    filename:    `Anahuac-Tax-Report-${year}.pdf`,
    image:       { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF:       { unit: 'in', format: 'letter', orientation: 'landscape' },
    pagebreak:   { mode: ['css', 'legacy'] },
  }).from(el).save();
}
