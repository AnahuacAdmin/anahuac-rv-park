/*
 * Anahuac RV Park — Water Analytics
 */

async function loadWaterAnalytics() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }

  document.getElementById('page-content').innerHTML = '<div style="display:flex;justify-content:center;padding:3rem"><div class="loading-spinner"></div></div>';

  var data = await API.get('/water-meters/analytics');
  if (!data) return;

  document.getElementById('page-content').innerHTML =
    '<div class="page-header"><h2>💧 Water Analytics</h2><div class="btn-group">' +
      '<button class="btn btn-outline" onclick="exportWaterAnalyticsCSV()">📥 Export CSV</button>' +
    '</div></div>' +

    // Summary
    '<div class="dash-top-bar" style="margin-bottom:1rem">' +
      '<div class="dash-top-item dash-border-blue"><div class="dash-top-icon">💧</div><span class="dash-top-val">' + Number(data.totalGallons || 0).toLocaleString() + '</span><span class="dash-top-label">Gallons This Month</span></div>' +
      '<div class="dash-top-item"><div class="dash-top-icon">📊</div><span class="dash-top-val">' + (data.readingsCount || 0) + '</span><span class="dash-top-label">Readings Entered</span></div>' +
      '<div class="dash-top-item"><div class="dash-top-icon">📈</div><span class="dash-top-val">' + Number(data.avgPerLot || 0).toLocaleString() + '</span><span class="dash-top-label">Avg per Lot</span></div>' +
      (data.allowance ? '<div class="dash-top-item"><div class="dash-top-icon">🎯</div><span class="dash-top-val">' + Number(data.allowance).toLocaleString() + '</span><span class="dash-top-label">Allowance/Lot</span></div>' : '') +
    '</div>' +

    // Charts row
    '<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem">' +
      '<div class="card" style="flex:1;min-width:300px"><h3>Monthly Usage (Last 6 Months)</h3><div style="position:relative;height:220px"><canvas id="waterMonthlyChart"></canvas></div></div>' +
      '<div class="card" style="flex:1;min-width:300px"><h3>Top 10 Usage This Month</h3><div style="position:relative;height:220px"><canvas id="waterTopChart"></canvas></div></div>' +
    '</div>' +

    // Lot usage table
    '<div class="card">' +
      '<h3>All Lot Usage — ' + (data.currentMonth || '') + '</h3>' +
      '<div class="table-container"><table>' +
        '<thead><tr><th>Lot</th><th>Tenant</th><th>This Month</th><th>3-Month Avg</th>' +
          (data.allowance ? '<th>vs Allowance</th>' : '') +
          '<th>Status</th></tr></thead><tbody>' +
        (data.lotStats || []).map(function(l) {
          var name = ((l.first_name || '') + ' ' + (l.last_name || '')).trim() || '—';
          var thisMonth = l.this_month || 0;
          var avg = Math.round(l.avg_gallons || 0);
          var status = 'Normal';
          var statusBadge = 'badge-success';
          if (data.allowance && thisMonth > data.allowance * 1.5) { status = 'Very High'; statusBadge = 'badge-danger'; }
          else if (data.allowance && thisMonth > data.allowance) { status = 'High'; statusBadge = 'badge-warning'; }
          else if (avg > 0 && thisMonth > avg * 1.5) { status = 'High'; statusBadge = 'badge-warning'; }

          var overageCol = '';
          if (data.allowance) {
            var diff = thisMonth - data.allowance;
            overageCol = '<td style="color:' + (diff > 0 ? '#dc2626' : '#16a34a') + ';font-weight:600">' +
              (diff > 0 ? '+' : '') + diff.toLocaleString() + '</td>';
          }

          return '<tr><td><strong>' + escapeHtml(l.lot_id) + '</strong></td>' +
            '<td>' + escapeHtml(name) + '</td>' +
            '<td>' + thisMonth.toLocaleString() + '</td>' +
            '<td>' + avg.toLocaleString() + '</td>' +
            overageCol +
            '<td><span class="badge ' + statusBadge + '" style="font-size:0.65rem">' + status + '</span></td></tr>';
        }).join('') +
      '</tbody></table></div></div>' +

    // Month comparison
    '<div class="card" style="margin-top:1rem">' +
      '<h3>Month-over-Month Comparison</h3>' +
      '<div class="table-container"><table>' +
        '<thead><tr><th>Month</th><th>Readings</th><th>Total Gallons</th><th>Change</th></tr></thead><tbody>' +
        (data.monthlyHistory || []).map(function(m, i, arr) {
          var prev = i > 0 ? arr[i - 1].gallons : 0;
          var change = prev > 0 ? Math.round((m.gallons - prev) / prev * 100) : 0;
          var changeColor = change > 10 ? '#dc2626' : change < -10 ? '#16a34a' : '#78716c';
          return '<tr><td><strong>' + m.month + '</strong></td>' +
            '<td>' + m.readings + '</td>' +
            '<td>' + Number(m.gallons).toLocaleString() + '</td>' +
            '<td style="color:' + changeColor + ';font-weight:600">' + (i > 0 ? (change > 0 ? '+' : '') + change + '%' : '—') + '</td></tr>';
        }).join('') +
      '</tbody></table></div></div>';

  // Render charts
  renderWaterCharts(data);
}

function renderWaterCharts(data) {
  if (typeof Chart === 'undefined') return;
  setTimeout(function() {
    // Monthly usage chart
    var c1 = document.getElementById('waterMonthlyChart');
    if (c1) {
      new Chart(c1.getContext('2d'), {
        type: 'bar',
        data: {
          labels: (data.monthlyHistory || []).map(function(m) {
            var p = m.month.split('-');
            return new Date(p[0], p[1] - 1).toLocaleDateString('en-US', { month: 'short' });
          }),
          datasets: [{ label: 'Gallons', data: (data.monthlyHistory || []).map(function(m) { return m.gallons; }), backgroundColor: '#3b82f6', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } } }
      });
    }

    // Top usage chart
    var c2 = document.getElementById('waterTopChart');
    if (c2 && data.topUsage && data.topUsage.length) {
      new Chart(c2.getContext('2d'), {
        type: 'bar',
        data: {
          labels: data.topUsage.map(function(l) { return l.lot_id; }),
          datasets: [{ label: 'Gallons', data: data.topUsage.map(function(l) { return l.total_gallons; }), backgroundColor: data.topUsage.map(function(l) { return l.total_gallons > (data.allowance || Infinity) ? '#dc2626' : '#3b82f6'; }), borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true } } }
      });
    }
  }, 100);
}

async function exportWaterAnalyticsCSV() {
  var month = new Date().toISOString().slice(0, 7);
  try {
    var res = await fetch('/api/water-meters/export/csv?month=' + month, { headers: { 'Authorization': 'Bearer ' + API.token } });
    if (!res.ok) throw new Error('Export failed');
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'water-analytics-' + month + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (err) { alert('Export failed: ' + (err.message || 'unknown')); }
}
