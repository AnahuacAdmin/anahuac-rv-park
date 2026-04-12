/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
async function loadReports() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  const now = new Date();
  document.getElementById('page-content').innerHTML = `
    ${helpPanel('reports')}
    <div class="page-header">
      <h2>📊 Reports</h2>
      <div class="btn-group">
        <button class="btn btn-warning" onclick="showTaxReport()">🧾 Tax Reports</button>
        <button class="btn btn-outline" onclick="exportInvoicesToExcel()">📊 Export Invoices to Excel</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <h3>Monthly Income Report</h3>
      <div class="filter-bar" style="margin-bottom:0">
        <select id="report-month">
          ${[...Array(12)].map((_, i) => `<option value="${i+1}" ${i+1===now.getMonth()+1?'selected':''}>${new Date(2000,i).toLocaleString('default',{month:'long'})}</option>`).join('')}
        </select>
        <select id="report-year">
          ${[now.getFullYear(), now.getFullYear()-1].map(y => `<option value="${y}">${y}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="generateReport()">Generate Report</button>
      </div>
    </div>
    <div id="report-content"></div>
  `;
}

async function generateReport() {
  const month = document.getElementById('report-month').value;
  const year = document.getElementById('report-year').value;
  const data = await API.get(`/reports/monthly/${year}/${month}`);
  if (!data) return;
  const monthName = new Date(year, month-1).toLocaleString('default', { month: 'long', year: 'numeric' });

  document.getElementById('report-content').innerHTML = `
    <div class="dash-top-bar" style="margin:1rem 0">
      <div class="dash-top-item dash-border-green"><div class="dash-top-icon">💰</div><span class="dash-top-val">${formatMoney(data.collected)}</span><span class="dash-top-label">Total Collected</span></div>
      <div class="dash-top-item dash-border-blue"><div class="dash-top-icon">📋</div><span class="dash-top-val">${formatMoney(data.invoiced)}</span><span class="dash-top-label">Total Invoiced</span></div>
      <div class="dash-top-item dash-border-red"><div class="dash-top-icon">⚠️</div><span class="dash-top-val">${formatMoney(data.outstanding)}</span><span class="dash-top-label">Outstanding</span></div>
      <div class="dash-top-item dash-border-blue"><div class="dash-top-icon">🏕️</div><span class="dash-top-val">${data.occupancyRate}%</span><span class="dash-top-label">Occupancy (${data.occupied}/${data.totalLots - data.reserved})</span></div>
      <div class="dash-top-item dash-border-purple"><div class="dash-top-icon">⚡</div><span class="dash-top-val">${formatMoney(data.electricRev)}</span><span class="dash-top-label">Electric Revenue</span></div>
    </div>

    <div class="no-print btn-group" style="margin-bottom:1rem">
      <button class="btn btn-outline" onclick="window.print()">🖨️ Print Report</button>
      <button class="btn btn-outline" onclick="downloadReportPdf('${monthName}')">📥 Download PDF</button>
      <button class="btn btn-outline" onclick="downloadReportCsv(${JSON.stringify(data.tenantDetail).replace(/"/g,'&quot;')}, '${monthName}')">📊 Download CSV</button>
    </div>

    <div id="report-printable">
    <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem">
      <div class="card" style="flex:1;min-width:250px">
        <h3>By Rate Type</h3>
        <table><thead><tr><th>Type</th><th>Count</th><th>Paid</th></tr></thead><tbody>
          ${data.byRateType.map(r => `<tr><td>${r.rent_type || 'standard'}</td><td>${r.count}</td><td>${formatMoney(r.total_paid)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="card" style="flex:1;min-width:250px">
        <h3>Top 5 Highest Balances</h3>
        <table><thead><tr><th>Lot</th><th>Tenant</th><th>Balance</th></tr></thead><tbody>
          ${data.topBalances.map(t => `<tr><td>${t.lot_id}</td><td>${t.first_name} ${t.last_name}</td><td style="color:#dc2626;font-weight:700">${formatMoney(t.balance)}</td></tr>`).join('')}
        </tbody></table>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <h3>Payments Received — ${monthName}</h3>
      <div class="table-container" style="max-height:250px">
        <table><thead><tr><th>Date</th><th>Lot</th><th>Tenant</th><th>Amount</th><th>Method</th></tr></thead><tbody>
          ${data.payments.length ? data.payments.map(p => `<tr><td>${formatDate(p.payment_date)}</td><td>${p.lot_id}</td><td>${p.first_name} ${p.last_name}</td><td><strong>${formatMoney(p.amount)}</strong></td><td>${p.payment_method || '—'}</td></tr>`).join('') : '<tr><td colspan="5" class="text-center">No payments this month</td></tr>'}
        </tbody></table>
      </div>
    </div>

    <div class="card">
      <h3>Tenant Detail — ${monthName}</h3>
      <div class="table-container">
        <table><thead><tr><th>Lot</th><th>Name</th><th>Rate Type</th><th>Monthly Rate</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>
          ${data.tenantDetail.map(t => {
            const status = t.balance_due > 0 ? (t.amount_paid > 0 ? 'Partial' : 'Unpaid') : 'Paid';
            const color = status === 'Paid' ? '#16a34a' : status === 'Partial' ? '#f59e0b' : '#dc2626';
            return `<tr style="border-left:3px solid ${color}">
              <td><strong>${t.lot_id}</strong></td><td>${t.first_name} ${t.last_name}</td>
              <td>${t.rent_type || 'standard'}</td><td>${formatMoney(t.monthly_rent)}</td>
              <td>${formatMoney(t.amount_paid)}</td><td style="color:${color};font-weight:700">${formatMoney(t.balance_due)}</td>
              <td><span class="badge badge-${status==='Paid'?'success':status==='Partial'?'warning':'danger'}">${status}</span></td>
            </tr>`;
          }).join('')}
        </tbody></table>
      </div>
    </div>
    </div>
  `;
}

async function downloadReportPdf(monthName) {
  const el = document.getElementById('report-printable');
  if (!el || typeof html2pdf === 'undefined') return;
  await html2pdf().set({
    margin: [0.3, 0.3, 0.4, 0.3], filename: `Income-Report-${monthName.replace(/\s/g,'-')}.pdf`,
    image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 1.5, useCORS: true, backgroundColor: '#fff', scrollY: 0 },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
  }).from(el).save();
}

function downloadReportCsv(tenantDetail, monthName) {
  if (typeof XLSX === 'undefined') { alert('Excel library not loaded.'); return; }
  // Parse back from HTML-encoded string if needed
  let data = tenantDetail;
  if (typeof data === 'string') try { data = JSON.parse(data); } catch { return; }
  const rows = data.map(t => ({
    Lot: t.lot_id, Name: `${t.first_name} ${t.last_name}`, 'Rate Type': t.rent_type || 'standard',
    'Monthly Rate': t.monthly_rent, 'Amount Paid': t.amount_paid, 'Balance Due': t.balance_due,
    Status: t.balance_due > 0 ? (t.amount_paid > 0 ? 'Partial' : 'Unpaid') : 'Paid',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch:6 },{ wch:22 },{ wch:12 },{ wch:12 },{ wch:12 },{ wch:12 },{ wch:10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, monthName);
  XLSX.writeFile(wb, `Income-Report-${monthName.replace(/\s/g,'-')}.xlsx`);
}
