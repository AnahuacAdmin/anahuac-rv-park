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
        <button class="btn btn-danger" onclick="showAdvancedBroadcast()">Send Notification</button>
        <button class="btn btn-success" onclick="showSharePortal()">📲 Share Tenant Portal</button>
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
      <div class="form-group">
        <label>Delivery Method</label>
        <select name="delivery_method">
          <option value="record">Record Only (no send)</option>
          <option value="sms">Send via SMS (Twilio)</option>
        </select>
      </div>
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
      <div class="form-group">
        <label>Delivery Method</label>
        <select name="delivery_method">
          <option value="record">Record Only (no send)</option>
          <option value="sms">Send via SMS (Twilio) to all tenants with phone</option>
        </select>
      </div>
      <p style="color:var(--warning);font-size:0.9rem">This will send to all active tenants.</p>
      <button type="submit" class="btn btn-warning btn-full mt-2">Send to All</button>
    </form>
  `);
}

async function sendMessage(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const r = await API.post('/messages', {
      tenant_id: parseInt(form.get('tenant_id')),
      subject: form.get('subject'),
      body: form.get('body'),
      message_type: form.get('message_type'),
      delivery_method: form.get('delivery_method'),
      is_broadcast: false
    });
    closeModal();
    if (r?.smsSent) alert('Message recorded and SMS sent.');
    else if (r?.smsFailed) alert('Message recorded. SMS failed: ' + (r.errors?.join('; ') || 'unknown'));
    loadMessages();
  } catch (err) {
    alert('Send failed: ' + (err.message || 'unknown'));
  }
}

async function sendBroadcast(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const result = await API.post('/messages', {
      subject: form.get('subject'),
      body: form.get('body'),
      message_type: form.get('message_type'),
      delivery_method: form.get('delivery_method'),
      is_broadcast: true
    });
    closeModal();
    let msg = `Broadcast recorded for ${result.sent} tenants.`;
    if (result.smsSent || result.smsFailed) {
      msg += `\nSMS sent: ${result.smsSent || 0}, failed: ${result.smsFailed || 0}.`;
    }
    alert(msg);
    loadMessages();
  } catch (err) {
    alert('Broadcast failed: ' + (err.message || 'unknown'));
  }
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

// --- Advanced Notification System ---
const MSG_TEMPLATES = {
  late_payment: { subject: 'Payment Reminder', message: 'Hi [name], your account at Anahuac RV Park has a balance due. Please pay at anrvpark.com or call 409-267-6603.' },
  weather_emergency: { subject: 'WEATHER EMERGENCY', message: 'URGENT - Anahuac RV Park: Please take necessary precautions for the incoming weather event. Secure outdoor items, stay indoors if possible. Call 409-267-6603 for assistance.' },
  power_outage: { subject: 'Power Outage Notice', message: 'Anahuac RV Park Notice: We are experiencing a power outage. Our team is working to restore power. We apologize for the inconvenience. Call 409-267-6603 for updates.' },
  general: { subject: 'Park Announcement', message: 'Anahuac RV Park: ' },
  custom: { subject: '', message: '' },
};

async function showAdvancedBroadcast() {
  const lots = await API.get('/lots');
  showModal('Send Notification', `
    <form onsubmit="sendAdvancedBroadcast(event)">
      <div class="form-row">
        <div class="form-group">
          <label>Message Type</label>
          <select name="message_type" onchange="fillTemplate(this.value)">
            <option value="late_payment">Late Payment Reminder</option>
            <option value="weather_emergency">Weather/Climate Emergency</option>
            <option value="power_outage">Power Outage Notice</option>
            <option value="general">General Announcement</option>
            <option value="custom">Custom Message</option>
          </select>
        </div>
        <div class="form-group">
          <label>Recipients</label>
          <select name="recipients">
            <option value="all">All Tenants</option>
            <option value="unpaid">Unpaid Tenants Only</option>
            ${(lots || []).filter(l => l.status === 'occupied').map(l => `<option value="lot:${l.id}">Lot ${l.id}${l.first_name ? ' — ' + l.first_name + ' ' + l.last_name : ''}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Delivery Method</label>
        <select name="delivery">
          <option value="both">SMS + Email</option>
          <option value="sms">SMS Only</option>
          <option value="email">Email Only</option>
        </select>
      </div>
      <div class="form-group">
        <label>Subject</label>
        <input name="subject" id="notif-subject" value="${MSG_TEMPLATES.late_payment.subject}">
      </div>
      <div class="form-group">
        <label>Message <small>(use [name] for tenant name, [lot] for lot #)</small></label>
        <textarea name="message" id="notif-message" rows="5">${MSG_TEMPLATES.late_payment.message}</textarea>
      </div>
      <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:1rem;font-size:0.8rem;color:#1e40af">
        Respects tenant preferences: tenants who opted out of SMS/email will be skipped automatically.
      </div>
      <button type="submit" class="btn btn-danger btn-full">Send Notification</button>
      <p id="notif-error" class="error-text" style="display:none"></p>
    </form>
  `);
}

function fillTemplate(type) {
  const t = MSG_TEMPLATES[type] || MSG_TEMPLATES.custom;
  document.getElementById('notif-subject').value = t.subject;
  document.getElementById('notif-message').value = t.message;
}

async function sendAdvancedBroadcast(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = {
    message_type: form.get('message_type'),
    recipients: form.get('recipients'),
    delivery: form.get('delivery'),
    subject: form.get('subject'),
    message: form.get('message'),
  };
  if (!data.message.trim()) {
    const errEl = document.getElementById('notif-error');
    if (errEl) { errEl.textContent = 'Message cannot be empty.'; errEl.style.display = ''; }
    return;
  }
  if (!confirm(`Send this notification to ${data.recipients === 'all' ? 'ALL tenants' : data.recipients === 'unpaid' ? 'unpaid tenants' : data.recipients}?`)) return;

  const toast = showStatusToast('📢', 'Sending notifications...');
  try {
    const r = await API.post('/messages/broadcast-advanced', data);
    toast.update('✅', 'Notifications sent!');
    toast.hide(3000);
    closeModal();
    let msg = `Notification complete!\n\n`;
    msg += `Recipients: ${r.totalRecipients}\n`;
    if (data.delivery !== 'email') msg += `SMS sent: ${r.smsSent}, skipped: ${r.smsSkipped}, failed: ${r.smsFailed}\n`;
    if (data.delivery !== 'sms') msg += `Email sent: ${r.emailSent}, skipped: ${r.emailSkipped}, failed: ${r.emailFailed}\n`;
    if (r.errors?.length) msg += `\nErrors:\n${r.errors.join('\n')}`;
    setTimeout(() => alert(msg), 500);
    loadMessages();
  } catch (err) {
    toast.hide(0);
    alert('Notification failed: ' + (err.message || 'unknown'));
  }
}

// --- Share Tenant Portal ---
const PORTAL_URL = APP_URL + '/portal.html';
const PORTAL_MSG_TEMPLATE = (name) => `Hi ${name}! Anahuac RV Park now has an online tenant portal where you can view your balance and pay your bill online. Access it here: ${PORTAL_URL} - Log in with your lot number and last name, then set up a 4-digit PIN. Questions? Call us at 409-267-6603`;

async function showSharePortal() {
  const tenants = await API.get('/tenants');
  if (!tenants) return;
  showModal('📲 Share Tenant Portal', `
    <p style="margin-bottom:1rem;font-size:0.9rem;color:var(--gray-500)">Send the portal link to tenants via SMS so they can view their balance and pay online.</p>
    <div class="form-group">
      <label>Send To</label>
      <select id="portal-recipient" onchange="portalRecipientChanged()">
        <option value="">Select a tenant...</option>
        <option value="ALL">📢 ALL Active Tenants</option>
        ${tenants.filter(t => t.phone).map(t => `<option value="${t.id}" data-name="${t.first_name}" data-phone="${t.phone}">${t.lot_id} — ${t.first_name} ${t.last_name} (${t.phone})</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Message (editable)</label>
      <textarea id="portal-msg-text" rows="5" style="font-size:0.85rem">${PORTAL_MSG_TEMPLATE('[Name]')}</textarea>
    </div>
    <button class="btn btn-success btn-full" onclick="sendPortalLink()">Send Portal Link</button>
    <p id="portal-send-error" class="error-text" style="display:none"></p>
    <p style="margin-top:0.5rem;font-size:0.75rem;color:var(--gray-500)">${tenants.filter(t => !t.phone).length} tenants have no phone number and will be skipped.</p>
  `);
}

function portalRecipientChanged() {
  const sel = document.getElementById('portal-recipient');
  const opt = sel.selectedOptions[0];
  const name = opt?.dataset?.name || '[Name]';
  document.getElementById('portal-msg-text').value = PORTAL_MSG_TEMPLATE(sel.value === 'ALL' ? '[Name]' : name);
}

async function sendPortalLink() {
  const sel = document.getElementById('portal-recipient');
  const msg = document.getElementById('portal-msg-text').value;
  const errEl = document.getElementById('portal-send-error');
  if (errEl) errEl.style.display = 'none';
  if (!sel.value) { if (errEl) { errEl.textContent = 'Please select a recipient.'; errEl.style.display = ''; } return; }
  if (!msg.trim()) { if (errEl) { errEl.textContent = 'Message cannot be empty.'; errEl.style.display = ''; } return; }

  if (sel.value === 'ALL') {
    if (!confirm('Send the portal link to ALL active tenants with phone numbers? This may send many SMS messages.')) return;
    const toast = showStatusToast('📲', 'Sending portal links...');
    try {
      const r = await API.post('/messages/broadcast-advanced', {
        message_type: 'portal_invite',
        recipients: 'all',
        delivery: 'sms',
        subject: 'Tenant Portal',
        message: msg.replace('[Name]', '[name]'),
      });
      toast.update('✅', `Portal links sent!`);
      toast.hide(3000);
      closeModal();
      setTimeout(() => alert(`Sent: ${r.smsSent}\nSkipped (no phone/opted out): ${r.smsSkipped}\nFailed: ${r.smsFailed}`), 500);
      loadMessages();
    } catch (err) {
      toast.hide(0);
      alert('Failed: ' + (err.message || 'unknown'));
    }
  } else {
    const opt = sel.selectedOptions[0];
    const name = opt?.dataset?.name || 'Tenant';
    const phone = opt?.dataset?.phone;
    if (!phone) { if (errEl) { errEl.textContent = 'This tenant has no phone number.'; errEl.style.display = ''; } return; }

    const personalMsg = msg.replace('[Name]', name).replace('[name]', name);
    const toast = showStatusToast('📲', `Sending to ${name}...`);
    try {
      await API.post('/messages', {
        tenant_id: parseInt(sel.value),
        subject: 'Tenant Portal Link',
        body: personalMsg,
        message_type: 'portal_invite',
        delivery_method: 'sms',
        is_broadcast: false,
      });
      toast.update('✅', `Portal link sent to ${name}!`);
      toast.hide(3000);
      closeModal();
      loadMessages();
    } catch (err) {
      toast.hide(0);
      alert('Failed: ' + (err.message || 'unknown'));
    }
  }
}
