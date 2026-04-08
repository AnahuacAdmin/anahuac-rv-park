async function loadBilling() {
  const invoices = await API.get('/invoices');
  if (!invoices) return;

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('billing')}
    <div class="page-header">
      <h2>Billing & Invoices</h2>
      <div class="btn-group">
        <button class="btn btn-success" onclick="showGenerateInvoices()">Generate Monthly Invoices</button>
        <button class="btn btn-primary" onclick="showCreateInvoice()">+ Single Invoice</button>
      </div>
    </div>
    <div class="filter-bar">
      <select onchange="filterInvoices(this.value)" id="invoice-filter">
        <option value="all">All Invoices</option>
        <option value="pending">Pending</option>
        <option value="partial">Partial</option>
        <option value="paid">Paid</option>
      </select>
    </div>
    <div class="card">
      <div class="table-container table-scroll billing-scroll">
        <table class="billing-table">
          <thead><tr><th>Invoice #</th><th>Lot</th><th>Tenant</th><th>Date</th><th>Rent</th><th>Electric</th><th>Mailbox</th><th>Misc</th><th>Late Fee</th><th>Refund</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
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
  if (!invoices.length) return '<tr><td colspan="15" class="text-center">No invoices yet. Generate monthly invoices to get started.</td></tr>';
  return invoices.map(inv => `
    <tr class="invoice-row" data-status="${inv.status}">
      <td>${inv.invoice_number}</td>
      <td><strong>${inv.lot_id}</strong></td>
      <td>${inv.first_name} ${inv.last_name}</td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td>${formatMoney(inv.rent_amount)}</td>
      <td>${formatMoney(inv.electric_amount)}</td>
      <td>${formatMoney(inv.mailbox_fee)}</td>
      <td>${formatMoney(inv.misc_fee)}${inv.misc_description ? ` <small>(${inv.misc_description})</small>` : ''}</td>
      <td>${formatMoney(inv.late_fee)}</td>
      <td>${inv.refund_amount ? '-' + formatMoney(inv.refund_amount) : formatMoney(0)}${inv.refund_description ? ` <small>(${inv.refund_description})</small>` : ''}</td>
      <td><strong>${formatMoney(inv.total_amount)}</strong></td>
      <td>${formatMoney(inv.amount_paid)}</td>
      <td><strong>${formatMoney(inv.balance_due)}</strong></td>
      <td><span class="badge badge-${inv.status === 'paid' ? 'success' : inv.status === 'partial' ? 'warning' : 'danger'}">${inv.status}</span></td>
      <td class="btn-group">
        <button class="btn btn-sm btn-outline" onclick="viewInvoice(${inv.id})">View</button>
        <button class="btn btn-sm btn-outline" onclick="downloadInvoicePdf(${inv.id})">PDF</button>
        <button class="btn btn-sm btn-outline" onclick="emailInvoice(${inv.id})">Email</button>
        <button class="btn btn-sm btn-primary" onclick="editInvoice(${inv.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteInvoice(${inv.id})">Del</button>
      </td>
    </tr>
  `).join('');
}

function filterInvoices(status) {
  if (!window._allInvoices) return;
  const filtered = status === 'all' ? window._allInvoices : window._allInvoices.filter(i => i.status === status);
  document.getElementById('invoices-body').innerHTML = renderInvoiceRows(filtered);
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
    </form>
  `);
}

async function createInvoice(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);
  data.tenant_id = parseInt(data.tenant_id);
  data.rent_amount = parseFloat(data.rent_amount) || 0;
  data.electric_amount = parseFloat(data.electric_amount) || 0;
  data.other_charges = parseFloat(data.other_charges) || 0;
  data.late_fee = parseFloat(data.late_fee) || 0;
  data.mailbox_fee = parseFloat(data.mailbox_fee) || 0;
  data.misc_fee = parseFloat(data.misc_fee) || 0;
  data.refund_amount = parseFloat(data.refund_amount) || 0;
  await API.post('/invoices', data);
  closeModal();
  loadBilling();
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
          <p>Due: ${formatDate(inv.due_date)}</p>
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
            ${inv.meter ? `
              <tr><td>Previous Reading</td><td class="text-right">${inv.meter.previous_reading}</td></tr>
              <tr><td>Current Reading</td><td class="text-right">${inv.meter.current_reading}</td></tr>
              <tr><td>kWh Used</td><td class="text-right">${inv.meter.kwh_used}</td></tr>
              <tr><td>Electric Charge (${inv.meter.kwh_used} kWh @ $${Number(inv.meter.rate_per_kwh).toFixed(2)}/kWh)</td><td class="text-right">${formatMoney(inv.electric_amount)}</td></tr>
            ` : `<tr><td>Electric Charges</td><td class="text-right">${formatMoney(inv.electric_amount)}</td></tr>`}
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
      ${inv.payments?.length ? `
        <h4 class="mt-2">Payment History</h4>
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead>
          <tbody>${inv.payments.map(p => `<tr><td>${formatDate(p.payment_date)}</td><td>${formatMoney(p.amount)}</td><td>${p.payment_method || '—'}</td></tr>`).join('')}</tbody>
        </table>
      ` : ''}
    </div>
    <div class="no-print mt-2 btn-group">
      <button class="btn btn-primary" onclick="window.print()">Print Invoice</button>
      <button class="btn btn-outline" onclick="downloadInvoicePdfFromView('${inv.invoice_number}')">Download PDF</button>
      <button class="btn btn-outline" onclick="emailInvoice(${inv.id})">Email Invoice</button>
    </div>
  `);
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
          <p>Due: ${formatDate(inv.due_date)}</p>
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
            ${inv.meter ? `
              <tr><td>Previous Reading</td><td class="text-right">${inv.meter.previous_reading}</td></tr>
              <tr><td>Current Reading</td><td class="text-right">${inv.meter.current_reading}</td></tr>
              <tr><td>kWh Used</td><td class="text-right">${inv.meter.kwh_used}</td></tr>
              <tr><td>Electric Charge (${inv.meter.kwh_used} kWh @ $${Number(inv.meter.rate_per_kwh).toFixed(2)}/kWh)</td><td class="text-right">${formatMoney(inv.electric_amount)}</td></tr>
            ` : `<tr><td>Electric Charges</td><td class="text-right">${formatMoney(inv.electric_amount)}</td></tr>`}
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
    </div>
  `;
}

// Email Invoice — mailto fallback (no SMTP configured).
// If you want real server-side email with PDF attachment, tell me which provider
// and I'll wire up nodemailer with env vars.
async function emailInvoice(id) {
  const inv = await API.get(`/invoices/${id}`);
  if (!inv) return;
  const to = inv.email || '';
  const subject = encodeURIComponent(`Anahuac RV Park — Invoice ${inv.invoice_number}`);
  const body = encodeURIComponent(
`Hello ${inv.first_name},

Please find your invoice details below:

Invoice #:    ${inv.invoice_number}
Lot:          ${inv.lot_id}
Date:         ${inv.invoice_date}
Due:          ${inv.due_date}
Total:        $${Number(inv.total_amount).toFixed(2)}
Balance Due:  $${Number(inv.balance_due).toFixed(2)}

A PDF copy is attached separately. Thank you!

Anahuac RV Park, LLC
1003 Davis Ave, Anahuac, TX 77514
409-267-6603`
  );
  if (!to) {
    if (!confirm('No email address on file for this tenant. Open mail client anyway?')) return;
  }
  // Also auto-download the PDF so the user can attach it.
  await downloadInvoicePdf(id);
  window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
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
  if (!confirm('Delete this invoice and associated payments?')) return;
  await API.del(`/invoices/${id}`);
  loadBilling();
}
