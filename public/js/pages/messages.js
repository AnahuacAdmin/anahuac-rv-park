async function loadMessages() {
  const messages = await API.get('/messages');
  if (!messages) return;

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('messages')}
    <div class="page-header">
      <h2>Messaging</h2>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="showSendMessage()">Send Message</button>
        <button class="btn btn-warning" onclick="showBroadcast()">Broadcast to All</button>
      </div>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>Date</th><th>Tenant</th><th>Lot</th><th>Subject</th><th>Type</th><th>Actions</th></tr></thead>
          <tbody>
            ${messages.length ? messages.map(m => `
              <tr>
                <td>${new Date(m.sent_date).toLocaleString()}</td>
                <td>${m.first_name ? m.first_name + ' ' + m.last_name : 'All Tenants'}</td>
                <td>${m.lot_id || '—'}</td>
                <td>${m.subject || '(no subject)'}</td>
                <td><span class="badge badge-${m.message_type === 'urgent' ? 'danger' : m.message_type === 'reminder' ? 'warning' : 'info'}">${m.message_type}</span>
                  ${m.is_broadcast ? '<span class="badge badge-gray">broadcast</span>' : ''}
                </td>
                <td class="btn-group">
                  <button class="btn btn-sm btn-outline" onclick="viewMessage(${m.id}, '${(m.subject || '').replace(/'/g, "\\'")}', \`${(m.body || '').replace(/`/g, "\\`").replace(/\n/g, '<br>')}\`, '${m.first_name || 'All'} ${m.last_name || 'Tenants'}')">View</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteMessage(${m.id})">Del</button>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="6" class="text-center">No messages sent</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function showSendMessage() {
  const tenants = await API.get('/tenants');
  showModal('Send Message', `
    <form onsubmit="sendMessage(event)">
      <div class="form-group">
        <label>To Tenant</label>
        <select name="tenant_id" required>
          <option value="">Select tenant...</option>
          ${tenants.map(t => `<option value="${t.id}">${t.lot_id} - ${t.first_name} ${t.last_name}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Subject</label><input name="subject" required></div>
        <div class="form-group">
          <label>Type</label>
          <select name="message_type">
            <option value="notice">Notice</option>
            <option value="reminder">Reminder</option>
            <option value="urgent">Urgent</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Message</label><textarea name="body" rows="5" required></textarea></div>
      <button type="submit" class="btn btn-primary btn-full mt-2">Send</button>
    </form>
  `);
}

function showBroadcast() {
  showModal('Broadcast to All Tenants', `
    <form onsubmit="sendBroadcast(event)">
      <div class="form-row">
        <div class="form-group"><label>Subject</label><input name="subject" required></div>
        <div class="form-group">
          <label>Type</label>
          <select name="message_type">
            <option value="notice">Notice</option>
            <option value="reminder">Reminder</option>
            <option value="urgent">Urgent</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Message</label><textarea name="body" rows="5" required></textarea></div>
      <p style="color:var(--warning);font-size:0.9rem">This will send to all active tenants.</p>
      <button type="submit" class="btn btn-warning btn-full mt-2">Send to All</button>
    </form>
  `);
}

async function sendMessage(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  await API.post('/messages', {
    tenant_id: parseInt(form.get('tenant_id')),
    subject: form.get('subject'),
    body: form.get('body'),
    message_type: form.get('message_type'),
    is_broadcast: false
  });
  closeModal();
  loadMessages();
}

async function sendBroadcast(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const result = await API.post('/messages', {
    subject: form.get('subject'),
    body: form.get('body'),
    message_type: form.get('message_type'),
    is_broadcast: true
  });
  closeModal();
  alert(`Broadcast sent to ${result.sent} tenants`);
  loadMessages();
}

function viewMessage(id, subject, body, tenant) {
  showModal(subject || 'Message', `
    <p><strong>To:</strong> ${tenant}</p>
    <hr style="margin:1rem 0">
    <div>${body}</div>
  `);
}

async function deleteMessage(id) {
  if (!confirm('Delete this message?')) return;
  await API.del(`/messages/${id}`);
  loadMessages();
}
