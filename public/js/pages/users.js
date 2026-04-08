async function loadUsers() {
  if (API.user?.role !== 'admin') {
    document.getElementById('page-content').innerHTML = `
      <div class="page-header"><h2>User Management</h2></div>
      <div class="card"><p>Admin access required.</p></div>`;
    return;
  }
  const users = await API.get('/users');
  if (!users) return;

  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <h2>User Management</h2>
      <button class="btn btn-primary" onclick="showAddUser()">+ New User</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td><strong>${escapeHtml(u.username)}</strong>${u.id === API.user.id ? ' <em>(you)</em>' : ''}</td>
                <td>${u.role}</td>
                <td>${u.created_at ? formatDate(u.created_at.split(' ')[0]) : '—'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="showEditUser(${u.id}, '${escapeAttr(u.username)}', '${u.role}')">Edit</button>
                  <button class="btn btn-sm btn-outline" onclick="showResetUserPassword(${u.id}, '${escapeAttr(u.username)}')">Reset Password</button>
                  ${u.id !== API.user.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id}, '${escapeAttr(u.username)}')">Delete</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

function showAddUser() {
  showModal('New User', `
    <form onsubmit="createUser(event)">
      <div class="form-group"><label>Username</label><input name="username" required></div>
      <div class="form-group"><label>Password</label><input name="password" type="password" minlength="6" required></div>
      <div class="form-group">
        <label>Role</label>
        <select name="role">
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary btn-full mt-2">Create User</button>
      <p id="user-form-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

async function createUser(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await API.post('/users', {
      username: form.get('username'),
      password: form.get('password'),
      role: form.get('role'),
    });
    closeModal();
    loadUsers();
  } catch (err) {
    const errEl = document.getElementById('user-form-error');
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
}

function showEditUser(id, username, role) {
  showModal('Edit User', `
    <form onsubmit="updateUser(event, ${id})">
      <div class="form-group"><label>Username</label><input name="username" value="${escapeAttr(username)}" required></div>
      <div class="form-group">
        <label>Role</label>
        <select name="role">
          <option value="staff" ${role === 'staff' ? 'selected' : ''}>Staff</option>
          <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary btn-full mt-2">Save Changes</button>
      <p id="user-form-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

async function updateUser(e, id) {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await API.put(`/users/${id}`, { username: form.get('username'), role: form.get('role') });
    closeModal();
    loadUsers();
  } catch (err) {
    const errEl = document.getElementById('user-form-error');
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
}

function showResetUserPassword(id, username) {
  showModal(`Reset Password — ${username}`, `
    <form onsubmit="resetUserPassword(event, ${id})">
      <div class="form-group"><label>New Password</label><input name="newPassword" type="password" minlength="6" required></div>
      <button type="submit" class="btn btn-primary btn-full mt-2">Reset Password</button>
      <p id="user-form-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

async function resetUserPassword(e, id) {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await API.post(`/users/${id}/reset-password`, { newPassword: form.get('newPassword') });
    closeModal();
    alert('Password reset.');
  } catch (err) {
    const errEl = document.getElementById('user-form-error');
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  try {
    await API.del(`/users/${id}`);
    loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

// --- Self-service: change own password ---
function showChangeMyPassword() {
  showModal('Change My Password', `
    <form onsubmit="submitChangeMyPassword(event)">
      <div class="form-group"><label>Current Password</label><input name="currentPassword" type="password" required></div>
      <div class="form-group"><label>New Password</label><input name="newPassword" type="password" minlength="6" required></div>
      <div class="form-group"><label>Confirm New Password</label><input name="confirmPassword" type="password" minlength="6" required></div>
      <button type="submit" class="btn btn-primary btn-full mt-2">Change Password</button>
      <p id="user-form-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

async function submitChangeMyPassword(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const errEl = document.getElementById('user-form-error');
  errEl.style.display = 'none';
  if (form.get('newPassword') !== form.get('confirmPassword')) {
    errEl.textContent = 'New passwords do not match';
    errEl.style.display = '';
    return;
  }
  try {
    await API.post('/users/me/change-password', {
      currentPassword: form.get('currentPassword'),
      newPassword: form.get('newPassword'),
    });
    closeModal();
    alert('Password changed successfully.');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
}
