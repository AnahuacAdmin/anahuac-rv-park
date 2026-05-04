/*
 * Anahuac RV Park — Activity Log (Admin)
 * Full chronological activity feed with filters and search
 */

var _actLogPage = 0;
var _actLogType = '';
var _actLogSearch = '';

async function loadActivityLog() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = '<div class="card"><p>Admin access required.</p></div>';
    return;
  }
  _actLogPage = 0;
  _actLogType = '';
  _actLogSearch = '';

  document.getElementById('page-content').innerHTML =
    '<div class="page-header"><h2>📋 Community Activity Log</h2></div>' +
    '<div class="card" style="padding:0.6rem 0.75rem;margin-bottom:0.75rem">' +
      '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">' +
        '<select id="act-filter-type" onchange="filterActivityLog()" style="font-size:0.82rem;padding:5px 8px;border:1px solid #d6d3d1;border-radius:6px;background:#fff">' +
          '<option value="">All Activity</option>' +
          '<option value="catch">🎣 Catches</option>' +
          '<option value="comment">💬 Comments</option>' +
          '<option value="reaction">❤️ Reactions</option>' +
          '<option value="community">📢 Community Posts</option>' +
          '<option value="reply">💬 Replies</option>' +
          '<option value="birding">🐦 Bird Sightings</option>' +
          '<option value="lost-found">📦 Lost & Found</option>' +
          '<option value="chat">💬 Park Chat</option>' +
          '<option value="garden">🌱 Garden</option>' +
        '</select>' +
        '<input id="act-search" placeholder="Search activity..." oninput="debounceActivitySearch()" style="flex:1;min-width:150px;font-size:0.82rem;padding:5px 10px;border:1px solid #d6d3d1;border-radius:6px">' +
        '<button class="btn btn-sm btn-outline" onclick="loadActivityLogData()" style="font-size:0.78rem">🔄 Refresh</button>' +
      '</div>' +
    '</div>' +
    '<div id="act-log-action-bar"></div>' +
    '<div id="act-log-list">Loading...</div>' +
    '<div id="act-log-pager" style="text-align:center;margin:1rem 0"></div>';

  loadActivityLogData();
}

var _actSearchTimer = null;
function debounceActivitySearch() {
  clearTimeout(_actSearchTimer);
  _actSearchTimer = setTimeout(function() {
    _actLogPage = 0;
    loadActivityLogData();
  }, 300);
}

function filterActivityLog() {
  _actLogPage = 0;
  _actLogType = document.getElementById('act-filter-type')?.value || '';
  loadActivityLogData();
}

async function loadActivityLogData() {
  var list = document.getElementById('act-log-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:2rem;color:#a8a29e">Loading...</div>';

  _actLogSearch = document.getElementById('act-search')?.value || '';
  var limit = 30;
  var offset = _actLogPage * limit;

  try {
    var url = '/dashboard/activity-feed?limit=' + limit + '&offset=' + offset;
    if (_actLogType) url += '&type=' + encodeURIComponent(_actLogType);
    if (_actLogSearch) url += '&search=' + encodeURIComponent(_actLogSearch);
    var data = await API.get(url);
    if (!data || !data.items) { list.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">Could not load activity</div>'; return; }

    // Action items bar
    var actionBar = document.getElementById('act-log-action-bar');
    if (actionBar && data.actionCount > 0) {
      actionBar.innerHTML = '<div class="card" style="padding:0.5rem 0.75rem;margin-bottom:0.5rem;border-left:4px solid #dc2626;background:#fef2f2">' +
        '<strong style="color:#dc2626;font-size:0.85rem">🔴 ' + data.actionCount + ' item' + (data.actionCount > 1 ? 's' : '') + ' need your attention</strong>' +
      '</div>';
    } else if (actionBar) {
      actionBar.innerHTML = '';
    }

    if (!data.items.length) {
      list.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#78716c">No activity found' + (_actLogType || _actLogSearch ? ' matching your filters' : '') + '</div>';
    } else {
      var colorMap = { catch: '#16a34a', comment: '#0284c7', reaction: '#0284c7', community: '#7c3aed',
        reply: '#0284c7', birding: '#16a34a', 'lost-found': '#f59e0b' };
      var bgMap = { catch: '#f0fdf4', comment: '#eff6ff', reaction: '#eff6ff', community: '#f5f3ff',
        reply: '#eff6ff', birding: '#f0fdf4', 'lost-found': '#fffbeb' };
      var labelMap = { catch: 'Catch', comment: 'Comment', reaction: 'Reaction', community: 'Community',
        reply: 'Reply', birding: 'Bird Sighting', 'lost-found': 'Lost & Found' };

      list.innerHTML = data.items.map(function(item) {
        var color = colorMap[item.type] || '#78716c';
        var bg = bgMap[item.type] || '#f5f5f4';
        var label = labelMap[item.type] || item.type;
        var page = item.related_page || '';
        var onclick = page ? ' onclick="navigateTo(\'' + page + '\')" style="cursor:pointer"' : '';
        var actionDot = item.requires_action ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626;margin-right:6px;animation:actPulse 2s ease-in-out infinite;flex-shrink:0"></span>' : '';
        var ts = _actLogFormatTime(item.ts);

        return '<div class="card" style="padding:0.6rem 0.75rem;margin-bottom:0.35rem;border-left:4px solid ' + color + '"' + onclick + '>' +
          '<div style="display:flex;align-items:center;gap:0.5rem">' +
            actionDot +
            '<span style="font-size:1.1rem;flex-shrink:0">' + item.icon + '</span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:0.85rem;color:#1c1917;line-height:1.35">' + escapeHtml(item.text) + '</div>' +
              '<div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.15rem">' +
                '<span style="font-size:0.65rem;font-weight:700;padding:1px 6px;border-radius:3px;background:' + bg + ';color:' + color + '">' + label + '</span>' +
                '<span style="font-size:0.72rem;color:#a8a29e">' + ts + '</span>' +
                (item.requires_action ? '<span style="font-size:0.65rem;font-weight:700;padding:1px 5px;border-radius:3px;background:#fef2f2;color:#dc2626">ACTION NEEDED</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Pager
    var pager = document.getElementById('act-log-pager');
    if (pager) {
      var totalPages = Math.ceil(data.total / limit);
      var html = '';
      if (_actLogPage > 0) {
        html += '<button class="btn btn-sm btn-outline" onclick="_actLogPage--;loadActivityLogData()" style="margin:0 4px">← Previous</button>';
      }
      html += '<span style="font-size:0.78rem;color:#78716c;margin:0 8px">Page ' + (_actLogPage + 1) + ' of ' + Math.max(1, totalPages) + ' (' + data.total + ' items)</span>';
      if (offset + limit < data.total) {
        html += '<button class="btn btn-sm btn-outline" onclick="_actLogPage++;loadActivityLogData()" style="margin:0 4px">Next →</button>';
      }
      pager.innerHTML = html;
    }
  } catch {
    list.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:#dc2626">Failed to load activity feed</div>';
  }
}

function _actLogFormatTime(ts) {
  if (!ts) return '';
  try {
    var d = new Date(ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
    var diff = Date.now() - d.getTime();
    if (isNaN(diff)) return ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hr ago';
    if (diff < 172800000) return 'yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return ts; }
}
