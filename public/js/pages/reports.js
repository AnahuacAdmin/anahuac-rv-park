/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
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
        <button class="btn btn-primary" onclick="showEmailReport()">📧 Email Report</button>
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

    <!-- Charts Grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem" id="charts-grid">
      <div class="card"><h3>Monthly Revenue</h3><div style="height:250px"><canvas id="chartRevenue"></canvas></div></div>
      <div class="card"><h3>Occupancy Trend</h3><div style="height:250px"><canvas id="chartOccupancy"></canvas></div></div>
      <div class="card"><h3>Invoice Status</h3><div style="height:250px"><canvas id="chartStatus"></canvas></div></div>
      <div class="card"><h3>Revenue by Tenant Type</h3><div style="height:250px"><canvas id="chartByType"></canvas></div></div>
      <div class="card"><h3>Electric Usage & Revenue</h3><div style="height:250px"><canvas id="chartElectric"></canvas></div></div>
      <div class="card"><h3>Top Outstanding Balances</h3><div style="height:250px"><canvas id="chartOutstanding"></canvas></div></div>
    </div>

    <div id="report-content"></div>
  `;

  // Load trends and render charts
  loadReportCharts();
}

async function loadReportCharts() {
  if (typeof Chart === 'undefined') return;
  try {
    const t = await API.get('/reports/trends');
    if (!t) return;

    // Chart 1: Revenue bars
    const revCtx = document.getElementById('chartRevenue')?.getContext('2d');
    if (revCtx) {
      new Chart(revCtx, {
        type: 'bar',
        data: {
          labels: t.months.map(m => m.label),
          datasets: [
            { label: 'Collected', data: t.months.map(m => m.collected), backgroundColor: '#1a5c32', borderRadius: 4 },
            { label: 'Outstanding', data: t.months.map(m => m.outstanding), backgroundColor: '#dc2626', borderRadius: 4 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } } },
      });
    }

    // Chart 2: Occupancy line
    const occCtx = document.getElementById('chartOccupancy')?.getContext('2d');
    if (occCtx) {
      new Chart(occCtx, {
        type: 'line',
        data: {
          labels: t.months.map(m => m.label),
          datasets: [{ label: 'Occupancy %', data: t.months.map(m => m.occupancy), borderColor: '#1a5c32', backgroundColor: 'rgba(26,92,50,0.1)', fill: true, tension: 0.3, pointRadius: 3 }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } } },
      });
    }

    // Chart 3: Invoice status donut
    const stCtx = document.getElementById('chartStatus')?.getContext('2d');
    if (stCtx) {
      const paid = t.statusDist.find(s => s.status === 'paid')?.count || 0;
      const partial = t.statusDist.find(s => s.status === 'partial')?.count || 0;
      const pending = t.statusDist.find(s => s.status === 'pending')?.count || 0;
      new Chart(stCtx, {
        type: 'doughnut',
        data: {
          labels: ['Paid', 'Partial', 'Unpaid'],
          datasets: [{ data: [paid, partial, pending], backgroundColor: ['#16a34a', '#f59e0b', '#dc2626'], borderWidth: 2, borderColor: '#fff' }],
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } },
      });
    }

    // Chart 4: Revenue by type
    const tyCtx = document.getElementById('chartByType')?.getContext('2d');
    if (tyCtx) {
      const types = t.byType.map(r => r.rent_type || 'standard');
      const rents = t.byType.map(r => r.total_rent || 0);
      const flats = t.byType.map(r => r.flat_total || 0);
      new Chart(tyCtx, {
        type: 'bar',
        data: {
          labels: types,
          datasets: [
            { label: 'Rent', data: rents, backgroundColor: '#1a5c32', borderRadius: 4 },
            { label: 'Flat Rate', data: flats, backgroundColor: '#f59e0b', borderRadius: 4 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } } },
      });
    }

    // Chart 5: Electric usage & revenue
    const elCtx = document.getElementById('chartElectric')?.getContext('2d');
    if (elCtx) {
      const last6 = t.months.slice(-6);
      new Chart(elCtx, {
        type: 'line',
        data: {
          labels: last6.map(m => m.label),
          datasets: [
            { label: 'KWH', data: last6.map(m => m.electricKwh), borderColor: '#0284c7', backgroundColor: 'rgba(2,132,199,0.1)', fill: true, tension: 0.3, yAxisID: 'y' },
            { label: 'Revenue', data: last6.map(m => m.electricRev), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3, yAxisID: 'y1' },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { beginAtZero: true, position: 'left', ticks: { callback: v => v.toLocaleString() + ' kWh' } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => '$' + v.toLocaleString() } } } },
      });
    }

    // Chart 6: Top outstanding
    const obCtx = document.getElementById('chartOutstanding')?.getContext('2d');
    if (obCtx && t.topOutstanding.length) {
      new Chart(obCtx, {
        type: 'bar',
        data: {
          labels: t.topOutstanding.map(o => o.lot_id + ' ' + o.first_name),
          datasets: [{ label: 'Balance', data: t.topOutstanding.map(o => o.balance), backgroundColor: '#dc2626', borderRadius: 4 }],
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } } },
      });
    }
  } catch (err) { console.error('Charts failed:', err); }
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
      <button class="btn btn-primary" onclick="showEmailReport()">📧 Email Report</button>
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

// --- Email Report ---
function showEmailReport() {
  const now = new Date();
  const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  showModal('📧 Send Financial Report', `
    <form onsubmit="sendEmailReport(event)">
      <div class="form-group"><label>To</label><input name="to" type="email" value="anrvpark@gmail.com" required></div>
      <div class="form-group"><label>Subject</label><input name="subject" value="Anahuac RV Park — Financial Report — ${monthName}"></div>
      <div class="form-row">
        <div class="form-group"><label>Month</label>
          <select name="month">${[...Array(12)].map((_, i) => `<option value="${i+1}" ${i+1===now.getMonth()+1?'selected':''}>${new Date(2000,i).toLocaleString('default',{month:'long'})}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Year</label>
          <select name="year">${[now.getFullYear(), now.getFullYear()-1].map(y => `<option value="${y}">${y}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-group"><label>Message (optional)</label><textarea name="message" placeholder="Add a personal note..." rows="3"></textarea></div>
      <div class="btn-group" style="margin-top:1rem">
        <button type="submit" class="btn btn-primary" style="flex:1">📧 Send Email</button>
        <button type="button" class="btn btn-outline" style="flex:1" onclick="downloadFullReportPdf()">📥 Download PDF</button>
      </div>
      <p id="email-report-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

async function sendEmailReport(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const to = form.get('to');
  const subject = form.get('subject');
  const message = form.get('message') || '';
  const month = form.get('month');
  const year = form.get('year');

  try {
    showStatusToast('📧', 'Generating and sending report...', -1);

    // Get report data
    const data = await API.get(`/reports/monthly/${year}/${month}`);
    const monthName = new Date(year, month-1).toLocaleString('default', { month: 'long', year: 'numeric' });

    // Generate PDF from report content
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;top:-99999px;left:0;width:800px;background:#fff;visibility:hidden';
    wrap.innerHTML = buildReportHtml(data, monthName);
    document.body.appendChild(wrap);
    await new Promise(r => setTimeout(r, 300));

    const pdfBlob = await html2pdf().set({
      margin: [0.3, 0.3, 0.4, 0.3],
      filename: `AnahuacRVPark_Report_${monthName.replace(/\s/g, '')}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 1.5, useCORS: true, backgroundColor: '#fff' },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    }).from(wrap.firstElementChild).outputPdf('blob');
    wrap.remove();

    // Convert to base64
    const pdfBase64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(pdfBlob);
    });

    // Send via API
    await API.post('/reports/email', { to, subject, message, monthName, pdfBase64, summary: { collected: data.collected, invoiced: data.invoiced, outstanding: data.outstanding, occupancyRate: data.occupancyRate } });

    dismissToast();
    showStatusToast('✅', `Report sent to ${to}`);
    closeModal();
  } catch (err) {
    dismissToast();
    const errEl = document.getElementById('email-report-error');
    if (errEl) { errEl.textContent = err.message; errEl.style.display = ''; }
    else alert('Failed: ' + (err.message || 'unknown'));
  }
}

function buildReportHtml(data, monthName) {
  return `<div style="font-family:sans-serif;padding:1rem;max-width:750px;color:#1c1917">
    <div style="border-bottom:3px solid #1a5c32;padding-bottom:0.5rem;margin-bottom:1rem;display:flex;justify-content:space-between">
      <div><h2 style="color:#1a5c32;margin:0">Anahuac RV Park</h2><p style="color:#78716c;margin:0">Financial Report — ${monthName}</p></div>
      <div style="text-align:right;font-size:0.8rem;color:#78716c"><div>1003 Davis Ave, Anahuac TX 77514</div><div>409-267-6603</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-bottom:1rem">
      <div style="background:#f0fdf4;border-radius:8px;padding:0.75rem;text-align:center"><div style="font-size:1.2rem;font-weight:800;color:#1a5c32">${formatMoney(data.collected)}</div><div style="font-size:0.7rem;color:#78716c">Collected</div></div>
      <div style="background:#eff6ff;border-radius:8px;padding:0.75rem;text-align:center"><div style="font-size:1.2rem;font-weight:800;color:#0284c7">${formatMoney(data.invoiced)}</div><div style="font-size:0.7rem;color:#78716c">Invoiced</div></div>
      <div style="background:#fee2e2;border-radius:8px;padding:0.75rem;text-align:center"><div style="font-size:1.2rem;font-weight:800;color:#dc2626">${formatMoney(data.outstanding)}</div><div style="font-size:0.7rem;color:#78716c">Outstanding</div></div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-bottom:1rem">
      <thead><tr style="background:#fafaf9;border-bottom:2px solid #e7e5e4"><th style="padding:0.4rem;text-align:left">Lot</th><th style="padding:0.4rem;text-align:left">Tenant</th><th style="padding:0.4rem;text-align:right">Rate</th><th style="padding:0.4rem;text-align:right">Paid</th><th style="padding:0.4rem;text-align:right">Balance</th></tr></thead>
      <tbody>${data.tenantDetail.map(t => `<tr style="border-bottom:1px solid #e7e5e4"><td style="padding:0.3rem 0.4rem">${t.lot_id}</td><td style="padding:0.3rem">${t.first_name} ${t.last_name}</td><td style="padding:0.3rem;text-align:right">${formatMoney(t.monthly_rent)}</td><td style="padding:0.3rem;text-align:right">${formatMoney(t.amount_paid)}</td><td style="padding:0.3rem;text-align:right;color:${t.balance_due > 0 ? '#dc2626' : '#16a34a'}">${formatMoney(t.balance_due)}</td></tr>`).join('')}</tbody>
    </table>
    <div style="border-top:2px solid #1a5c32;padding-top:0.5rem;font-size:0.7rem;color:#78716c;text-align:center">&copy; 2026 Anahuac RV Park LLC | Confidential</div>
  </div>`;
}

async function downloadFullReportPdf() {
  const month = document.querySelector('#modal-body [name="month"]')?.value || (new Date().getMonth() + 1);
  const year = document.querySelector('#modal-body [name="year"]')?.value || new Date().getFullYear();
  const data = await API.get(`/reports/monthly/${year}/${month}`);
  if (!data) return;
  const monthName = new Date(year, month-1).toLocaleString('default', { month: 'long', year: 'numeric' });

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;top:-99999px;left:0;width:800px;background:#fff;visibility:hidden';
  wrap.innerHTML = buildReportHtml(data, monthName);
  document.body.appendChild(wrap);
  await new Promise(r => setTimeout(r, 300));
  await html2pdf().set({
    margin: [0.3, 0.3, 0.4, 0.3],
    filename: `AnahuacRVPark_Report_${monthName.replace(/\s/g, '')}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 1.5, useCORS: true, backgroundColor: '#fff' },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
  }).from(wrap.firstElementChild).save();
  wrap.remove();
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
