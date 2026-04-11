async function loadDashboard() {
  const data = await API.get('/dashboard');
  if (!data) return;

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('dashboard')}
    <div class="page-header">
      <h2>${getTimeGreeting()}, ${API.user?.username || 'Admin'}!</h2>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${data.totalLots}</div><div class="stat-label">Total Lots</div></div>
      <div class="stat-card success"><div class="stat-value">${data.occupied}</div><div class="stat-label">Occupied</div></div>
      <div class="stat-card warning"><div class="stat-value">${data.vacant}</div><div class="stat-label">Vacant</div></div>
      <div class="stat-card"><div class="stat-value">${data.occupancyRate}%</div><div class="stat-label">Occupancy Rate</div></div>
      <div class="stat-card success"><div class="stat-value">${formatMoney(data.monthlyRevenue)}</div><div class="stat-label">Revenue This Month</div></div>
      <div class="stat-card danger"><div class="stat-value">${formatMoney(data.totalOutstanding)}</div><div class="stat-label">Outstanding Balance</div></div>
      <div class="stat-card warning"><div class="stat-value">${data.pendingInvoices}</div><div class="stat-label">Pending Invoices</div></div>
      <div class="stat-card"><div class="stat-value">${data.waitlistCount}</div><div class="stat-label">On Waitlist</div></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Recent Payments</h3></div>
      <div class="table-container">
        <table>
          <thead><tr><th>Date</th><th>Tenant</th><th>Lot</th><th>Amount</th></tr></thead>
          <tbody>
            ${data.recentPayments.length ? data.recentPayments.map(p => `
              <tr>
                <td>${formatDate(p.payment_date)}</td>
                <td>${p.first_name} ${p.last_name}</td>
                <td>${p.lot_id}</td>
                <td>${formatMoney(p.amount)}</td>
              </tr>
            `).join('') : '<tr><td colspan="4" class="text-center">No payments recorded yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${data.activeTenants}</div><div class="stat-label">Active Tenants</div></div>
      <div class="stat-card"><div class="stat-value">${Math.round(data.totalKwh).toLocaleString()}</div><div class="stat-label">Total kWh (Latest)</div></div>
      <div class="stat-card"><div class="stat-value">${data.reserved}</div><div class="stat-label">Owner Reserved</div></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:0.75rem">&#128101; Guest Management</h3>
      <div class="stats-grid">
        <div class="stat-card success"><div class="stat-value">${data.activeTenants}</div><div class="stat-label">Checked In</div></div>
        <div class="stat-card warning"><div class="stat-value">${data.pendingReservations || 0}</div><div class="stat-label">Pending Reservations</div></div>
        <div class="stat-card"><div class="stat-value">${data.waitlistCount}</div><div class="stat-label">On Waitlist</div></div>
      </div>
      <div class="btn-group mt-1">
        <button class="btn btn-sm btn-success" onclick="navigateTo('checkins')">Check-In/Out</button>
        <button class="btn btn-sm btn-outline" onclick="navigateTo('reservations')">Reservations</button>
        <button class="btn btn-sm btn-outline" onclick="navigateTo('tenants')">Tenants</button>
      </div>
    </div>
    <div class="daily-tip">${getDailyTip()}</div>
  `;
}
