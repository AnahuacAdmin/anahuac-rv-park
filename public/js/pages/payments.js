/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
async function loadPayments() {
  const payments = await API.get('/payments');
  if (!payments) return;

  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('payments')}
    <div class="page-header">
      <h2>Payments Tracker</h2>
      <button class="btn btn-primary" onclick="showRecordPayment()">+ Record Payment</button>
    </div>
    <div class="stats-grid">
      <div class="stat-card success"><div class="stat-value">${formatMoney(totalCollected)}</div><div class="stat-label">Total Collected</div></div>
      <div class="stat-card"><div class="stat-value">${payments.length}</div><div class="stat-label">Total Payments</div></div>
    </div>
    <div class="card scrollable-table-card">
      <div class="table-container">
        <table>
          <thead><tr><th>Date</th><th>Lot</th><th>Guest</th><th>Amount</th><th>Method</th><th>Invoice</th><th>Reference</th><th>Actions</th></tr></thead>
          <tbody>
            ${payments.length ? payments.map(p => `
              <tr>
                <td>${formatDate(p.payment_date)}</td>
                <td><strong>${p.lot_id}</strong></td>
                <td>${p.first_name} ${p.last_name}</td>
                <td><strong>${formatMoney(p.amount)}</strong></td>
                <td>${p.payment_method || '—'}</td>
                <td>${p.invoice_number || '—'}</td>
                <td>${p.reference_number || '—'}</td>
                <td><button class="btn btn-sm btn-danger" onclick="deletePayment(${p.id})">Del</button></td>
              </tr>
            `).join('') : '<tr><td colspan="8" class="text-center">No payments recorded</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function showRecordPayment() {
  const [tenants, invoices] = await Promise.all([API.get('/tenants'), API.get('/invoices')]);
  const pendingInvoices = invoices.filter(i => i.status !== 'paid');

  showModal('Record Payment', `
    <form onsubmit="savePayment(event)">
      <div class="form-group">
        <label>Guest</label>
        <select name="tenant_id" required onchange="filterPaymentInvoices(this.value)">
          <option value="">Select guest...</option>
          ${tenants.map(t => `<option value="${t.id}">${t.lot_id} - ${t.first_name} ${t.last_name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Link to Invoice (optional)</label>
        <select name="invoice_id" id="payment-invoice-select">
          <option value="">No invoice link</option>
          ${pendingInvoices.map(i => `<option value="${i.id}" data-tenant="${i.tenant_id}">${i.invoice_number} - ${formatMoney(i.balance_due)} due</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Payment Date</label><input name="payment_date" type="date" value="${new Date().toISOString().split('T')[0]}" required></div>
        <div class="form-group"><label>Amount</label><input name="amount" type="number" step="0.01" required></div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Payment Method</label>
          <select name="payment_method">
            <option value="cash">Cash</option>
            <option value="check">Check</option>
            <option value="money_order">Money Order</option>
            <option value="card">Credit/Debit Card</option>
          </select>
        </div>
        <div class="form-group"><label>Reference #</label><input name="reference_number"></div>
      </div>
      <div id="payment-overpay-preview" style="display:none"></div>
      <div class="form-group"><label>Notes</label><textarea name="notes"></textarea></div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:0.5rem;font-weight:500">
          <input type="checkbox" name="send_sms_receipt" value="1">
          Send SMS receipt to tenant
        </label>
      </div>
      <button type="submit" class="btn btn-success btn-full mt-2">Record Payment</button>
    </form>
  `);
}

function filterPaymentInvoices(tenantId) {
  const select = document.getElementById('payment-invoice-select');
  Array.from(select.options).forEach(opt => {
    if (!opt.value) return;
    opt.style.display = opt.dataset.tenant === tenantId ? '' : 'none';
  });
  select.value = '';
  updatePaymentPreview();
}

function updatePaymentPreview() {
  var preview = document.getElementById('payment-overpay-preview');
  if (!preview) return;
  var invSelect = document.getElementById('payment-invoice-select');
  var amtInput = document.querySelector('form [name="amount"]');
  if (!invSelect || !amtInput) return;

  var amount = parseFloat(amtInput.value) || 0;
  var invOpt = invSelect.selectedOptions[0];
  if (!invOpt || !invOpt.value || amount <= 0) { preview.style.display = 'none'; return; }

  // Parse balance from option text "INV-xxx - $295.00 due"
  var match = invOpt.textContent.match(/\$([\d,]+\.?\d*)\s+due/);
  var invoiceDue = match ? parseFloat(match[1].replace(',', '')) : 0;
  if (invoiceDue <= 0) { preview.style.display = 'none'; return; }

  if (amount > invoiceDue + 0.005) {
    var overage = +(amount - invoiceDue).toFixed(2);
    preview.style.display = '';
    preview.innerHTML = `
      <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:0.75rem;margin-bottom:0.75rem">
        <div style="font-size:0.85rem;margin-bottom:0.5rem">
          <strong>Invoice Total:</strong> ${formatMoney(invoiceDue)}<br>
          <strong>Payment Amount:</strong> ${formatMoney(amount)}<br>
          <strong>Overage:</strong> <span style="color:#16a34a;font-weight:700">${formatMoney(overage)}</span>
        </div>
        <div style="font-size:0.85rem;font-weight:600;margin-bottom:0.5rem">Apply to:</div>
        <label style="display:flex;align-items:center;gap:0.35rem;padding:0.4rem 0;cursor:pointer;font-size:0.85rem">
          <input type="radio" name="hold_as_credit" value="" checked> Pay this invoice + credit overage (${formatMoney(overage)})
        </label>
        <label style="display:flex;align-items:center;gap:0.35rem;padding:0.4rem 0;cursor:pointer;font-size:0.85rem">
          <input type="radio" name="hold_as_credit" value="1"> Hold full ${formatMoney(amount)} as credit (no invoice paid)
        </label>
      </div>`;
  } else {
    preview.style.display = 'none';
  }
}

// Wire amount/invoice change to update preview
document.addEventListener('change', function(e) {
  if (e.target.name === 'amount' || e.target.id === 'payment-invoice-select') updatePaymentPreview();
});
document.addEventListener('input', function(e) {
  if (e.target.name === 'amount') updatePaymentPreview();
});

async function savePayment(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  var holdAsCredit = form.get('hold_as_credit') === '1';
  const data = {
    tenant_id: parseInt(form.get('tenant_id')),
    invoice_id: holdAsCredit ? null : (form.get('invoice_id') ? parseInt(form.get('invoice_id')) : null),
    payment_date: form.get('payment_date'),
    amount: parseFloat(form.get('amount')),
    payment_method: form.get('payment_method'),
    reference_number: form.get('reference_number'),
    notes: form.get('notes'),
    send_sms_receipt: form.get('send_sms_receipt') === '1',
    hold_as_credit: holdAsCredit,
  };
  try {
    const r = await API.post('/payments', data);
    closeModal();
    if (r?.held_as_credit > 0) {
      showCelebration('💚🏦', `${formatMoney(r.held_as_credit)} held as tenant credit!`);
    } else if (r?.overpayment > 0) {
      showCelebration('🎉💚', `Overpayment of ${formatMoney(r.overpayment)} added as credit!`);
    } else {
      showCelebration('💰🎉', 'Payment Recorded!');
    }
    if (r?.smsReceipt) {
      if (r.smsReceipt.sent) setTimeout(() => alert('SMS receipt sent.'), 3200);
      else setTimeout(() => alert('SMS receipt NOT sent: ' + (r.smsReceipt.reason || 'unknown')), 3200);
    }
    loadPayments();
  } catch (err) {
    alert('Failed to record payment: ' + (err.message || 'unknown'));
  }
}

async function deletePayment(id) {
  if (!confirm('Delete this payment? Invoice balances will be recalculated.')) return;
  await API.del(`/payments/${id}`);
  loadPayments();
}
