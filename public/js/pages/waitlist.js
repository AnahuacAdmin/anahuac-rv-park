async function loadWaitlist() {
  const entries = await API.get('/waitlist/all');
  if (!entries) return;

  const waiting = entries.filter(e => e.status === 'waiting');
  const contacted = entries.filter(e => e.status === 'contacted');
  const placed = entries.filter(e => e.status === 'placed');

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('waitlist')}
    <div class="page-header">
      <h2>Waitlist</h2>
      <button class="btn btn-primary" onclick="showAddWaitlist()">+ Add to Waitlist</button>
    </div>
    <div class="stats-grid">
      <div class="stat-card warning"><div class="stat-value">${waiting.length}</div><div class="stat-label">Waiting</div></div>
      <div class="stat-card"><div class="stat-value">${contacted.length}</div><div class="stat-label">Contacted</div></div>
      <div class="stat-card success"><div class="stat-value">${placed.length}</div><div class="stat-label">Placed</div></div>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>RV Length</th><th>Preferred Lot</th><th>Date Added</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${entries.length ? entries.map((e, i) => `
              <tr>
                <td>${e.position || i + 1}</td>
                <td>${e.first_name} ${e.last_name}</td>
                <td>${e.phone || '—'}</td>
                <td>${e.email || '—'}</td>
                <td>${e.rv_length || '—'}</td>
                <td>${e.preferred_lot || '—'}</td>
                <td>${formatDate(e.date_added)}</td>
                <td><span class="badge badge-${e.status === 'waiting' ? 'warning' : e.status === 'placed' ? 'success' : 'info'}">${e.status}</span></td>
                <td class="btn-group">
                  <button class="btn btn-sm btn-outline" onclick="editWaitlist(${e.id})">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="removeWaitlist(${e.id})">Del</button>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="9" class="text-center">Waitlist is empty</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function showAddWaitlist() {
  showModal('Add to Waitlist', waitlistForm());
}

async function editWaitlist(id) {
  const entries = await API.get('/waitlist/all');
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  showModal('Edit Waitlist Entry', waitlistForm(entry));
}

function waitlistForm(entry = {}) {
  return `
    <form onsubmit="saveWaitlist(event, ${entry.id || 'null'})">
      <div class="form-row">
        <div class="form-group"><label>First Name</label><input name="first_name" value="${entry.first_name || ''}" required></div>
        <div class="form-group"><label>Last Name</label><input name="last_name" value="${entry.last_name || ''}" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input name="phone" value="${entry.phone || ''}"></div>
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${entry.email || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>RV Length</label><input name="rv_length" value="${entry.rv_length || ''}"></div>
        <div class="form-group"><label>Preferred Lot</label><input name="preferred_lot" value="${entry.preferred_lot || ''}"></div>
      </div>
      ${entry.id ? `
        <div class="form-group">
          <label>Status</label>
          <select name="status">
            <option value="waiting" ${entry.status === 'waiting' ? 'selected' : ''}>Waiting</option>
            <option value="contacted" ${entry.status === 'contacted' ? 'selected' : ''}>Contacted</option>
            <option value="placed" ${entry.status === 'placed' ? 'selected' : ''}>Placed</option>
            <option value="cancelled" ${entry.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
        </div>
      ` : ''}
      <div class="form-group"><label>Notes</label><textarea name="notes">${entry.notes || ''}</textarea></div>
      <button type="submit" class="btn btn-primary btn-full mt-2">${entry.id ? 'Update' : 'Add to Waitlist'}</button>
    </form>
  `;
}

async function saveWaitlist(e, id) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = Object.fromEntries(form);
  if (id) {
    await API.put(`/waitlist/${id}`, data);
  } else {
    await API.post('/waitlist', data);
  }
  closeModal();
  loadWaitlist();
}

async function removeWaitlist(id) {
  if (!confirm('Remove from waitlist?')) return;
  await API.del(`/waitlist/${id}`);
  loadWaitlist();
}
