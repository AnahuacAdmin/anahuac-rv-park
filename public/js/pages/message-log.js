/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Message Log — admin view of all auto-sent messages
 */
async function loadMessageLog() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML =
      '<div class="page-header"><h2>Message Log</h2></div><div class="card"><p>Admin access required.</p></div>';
    return;
  }

  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <h2>Message Log</h2>
      <button class="btn btn-primary" onclick="loadMessageLog()">Refresh</button>
    </div>
    <div class="card">
      <div class="form-row" style="margin-bottom:1rem;gap:0.75rem;align-items:flex-end">
        <div class="form-group" style="flex:0 0 auto">
          <label>Filter by type</label>
          <select id="msglog-type-filter" onchange="loadMessageLogTable()" style="min-width:150px">
            <option value="">All types</option>
            <option value="birthday">Birthday</option>
            <option value="reminder">Reminder</option>
            <option value="weather">Weather</option>
          </select>
        </div>
      </div>
      <div id="msglog-table-wrap" style="overflow-x:auto">Loading...</div>
      <div id="msglog-pager" style="margin-top:0.75rem;display:flex;gap:0.5rem;align-items:center"></div>
    </div>
  `;

  loadMessageLogTable();
}

var _msgLogPage = 0;
var _msgLogLimit = 50;

async function loadMessageLogTable() {
  var wrap = document.getElementById('msglog-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="padding:1rem;color:#78716c">Loading...</div>';

  var typeFilter = document.getElementById('msglog-type-filter')?.value || '';
  var offset = _msgLogPage * _msgLogLimit;

  try {
    var url = '/admin/message-log?limit=' + _msgLogLimit + '&offset=' + offset;
    if (typeFilter) url += '&type=' + encodeURIComponent(typeFilter);
    var data = await API.get(url);
    var rows = data.rows || [];
    var total = data.total || 0;

    if (!rows.length) {
      wrap.innerHTML = '<div style="padding:1rem;color:#78716c">No messages logged yet. Auto-messages will appear here once sent.</div>';
      document.getElementById('msglog-pager').innerHTML = '';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Date/Time</th><th>Type</th><th>Recipient</th><th>Channel</th><th>Subject</th><th>Preview</th><th>Status</th>' +
      '</tr></thead><tbody>';

    rows.forEach(function(r) {
      var statusColor = r.status === 'sent' ? '#16a34a' :
                        r.status === 'failed' ? '#dc2626' :
                        r.status === 'blocked_duplicate' ? '#f59e0b' :
                        r.status === 'blocked_disabled' ? '#78716c' : '#6b7280';
      var statusLabel = r.status === 'blocked_duplicate' ? 'Blocked (Duplicate)' :
                        r.status === 'blocked_disabled' ? 'Blocked (Disabled)' :
                        r.status.charAt(0).toUpperCase() + r.status.slice(1);
      var date = r.created_at ? new Date(r.created_at + 'Z').toLocaleString() : '';
      var typeLabel = r.message_type ? r.message_type.charAt(0).toUpperCase() + r.message_type.slice(1) : '';
      var channelLabel = r.channel === 'in_app' ? 'In-App' : r.channel === 'sms' ? 'SMS' : (r.channel || '');

      html += '<tr>' +
        '<td style="white-space:nowrap;font-size:0.8rem">' + escapeHtml(date) + '</td>' +
        '<td><span style="background:#e5e7eb;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600">' + escapeHtml(typeLabel) + '</span></td>' +
        '<td>' + escapeHtml(r.recipient_name || '—') + (r.recipient_phone ? '<br><small style="color:#78716c">' + escapeHtml(r.recipient_phone) + '</small>' : '') + '</td>' +
        '<td>' + escapeHtml(channelLabel) + '</td>' +
        '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(r.subject || '') + '</td>' +
        '<td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;color:#78716c">' + escapeHtml((r.body_preview || '').slice(0, 100)) + '</td>' +
        '<td><span style="color:' + statusColor + ';font-weight:600;font-size:0.8rem">' + escapeHtml(statusLabel) + '</span></td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;

    // Pager
    var totalPages = Math.ceil(total / _msgLogLimit);
    var pager = document.getElementById('msglog-pager');
    if (totalPages > 1) {
      pager.innerHTML =
        '<button class="btn btn-outline btn-sm" ' + (_msgLogPage <= 0 ? 'disabled' : '') + ' onclick="_msgLogPage--;loadMessageLogTable()">Prev</button>' +
        '<span style="font-size:0.85rem;color:#78716c">Page ' + (_msgLogPage + 1) + ' of ' + totalPages + ' (' + total + ' total)</span>' +
        '<button class="btn btn-outline btn-sm" ' + (_msgLogPage >= totalPages - 1 ? 'disabled' : '') + ' onclick="_msgLogPage++;loadMessageLogTable()">Next</button>';
    } else {
      pager.innerHTML = '<span style="font-size:0.85rem;color:#78716c">' + total + ' message' + (total !== 1 ? 's' : '') + '</span>';
    }
  } catch (err) {
    wrap.innerHTML = '<div style="color:#dc2626;padding:1rem">Failed to load message log: ' + escapeHtml(err.message || 'unknown') + '</div>';
  }
}

