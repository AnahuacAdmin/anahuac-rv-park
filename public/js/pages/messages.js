/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
let _messagesCache = [];

function _msgDeliveryOption(name, value, emoji, label, desc, checked) {
  return '<label style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.85rem;border:1.5px solid ' + (checked ? '#1a5c32' : '#e0e0e0') + ';border-radius:8px;background:' + (checked ? '#f0fdf4' : '#fff') + ';cursor:pointer;transition:all 0.15s ease;font-weight:400" data-delivery-group="' + name + '">' +
    '<input type="radio" name="' + name + '" value="' + value + '"' + (checked ? ' checked' : '') + ' style="accent-color:#1a5c32;width:16px;height:16px;flex-shrink:0">' +
    '<span style="font-size:1.1rem;flex-shrink:0">' + emoji + '</span>' +
    '<span style="flex:1"><strong style="font-size:0.88rem;color:#1c1917">' + label + '</strong>' +
    '<span style="display:block;font-size:0.76rem;color:#78716c;margin-top:1px">' + desc + '</span></span></label>';
}

function _initDeliveryRadios(groupName) {
  setTimeout(function() {
    var allOpts = document.querySelectorAll('[data-delivery-group="' + groupName + '"]');
    document.querySelectorAll('input[name="' + groupName + '"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        var mode = this.value;
        allOpts.forEach(function(opt) {
          var isSelected = opt.querySelector('input').value === mode;
          opt.style.borderColor = isSelected ? '#1a5c32' : '#e0e0e0';
          opt.style.background = isSelected ? '#f0fdf4' : '#fff';
        });
      });
    });
  }, 50);
}

async function loadMessages() {
  const messages = await API.get('/messages');
  if (!messages) return;
  _messagesCache = messages || [];

  document.getElementById('page-content').innerHTML = `
    ${helpPanel('messages')}
    <div class="page-header">
      <h2>Messaging</h2>
      <div class="messaging-buttons">
        <div class="messaging-btn-wrap"><button class="btn btn-primary" onclick="showSendMessage()">Send Message</button><span class="messaging-btn-sub">General message to one guest</span></div>
        <div class="messaging-btn-wrap"><button class="btn btn-warning" onclick="showBroadcast()">Broadcast to All</button><span class="messaging-btn-sub">Notice · Reminder · Urgent · Maintenance</span></div>
        <div class="messaging-btn-wrap"><button class="btn btn-success" onclick="showSharePortal()">Share Guest Portal</button><span class="messaging-btn-sub">Send portal login link</span></div>
        <div class="messaging-btn-wrap"><button class="btn btn-danger" onclick="showEmergencyBroadcast()">Emergency Alert</button><span class="messaging-btn-sub">Hurricane · Tornado · Flood · Fire · Power · Custom</span></div>
      </div>
      <div class="msg-twilio-note">In-app notifications and email are free. SMS messages incur Twilio charges per text.</div>
    </div>
    <style>
      .messaging-buttons { display: flex; gap: 0.5rem; flex-wrap: wrap; }
      .messaging-btn-wrap { display: flex; flex-direction: column; align-items: center; }
      .messaging-btn-wrap .btn { min-width: 140px; }
      .messaging-btn-sub { font-size: 11px; color: #555; font-weight: 500; margin-top: 3px; text-align: center; max-width: 160px; line-height: 1.3; }
      .msg-twilio-note { text-align:center; margin-top:12px; font-size:12px; color:#666; font-style:italic; }
      .msg-card-list { display:none; }
      @media (max-width: 768px) {
        .messaging-buttons { display: grid; grid-template-columns: 1fr; gap: 10px; }
        .messaging-btn-wrap { flex-direction: row; align-items: center; gap: 0.75rem; }
        .messaging-btn-wrap .btn { width: 100%; min-width: 0; flex-shrink: 0; flex: 0 0 auto; width: auto; min-width: 130px; }
        .messaging-btn-sub { text-align: left; max-width: none; font-size: 10.5px; }
        .msg-twilio-note { margin-top: 8px; padding: 0 0.5rem; }
        .msg-desktop-table { display: none !important; }
        .msg-card-list { display: block !important; }
        .msg-card { background: #fff; border: 1px solid var(--gray-200, #e5e7eb); border-radius: 10px; padding: 0.75rem; margin-bottom: 0.5rem; }
        .msg-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; }
        .msg-card-guest { font-weight: 700; font-size: 0.88rem; }
        .msg-card-date { font-size: 0.7rem; color: #78716c; }
        .msg-card-subject { font-size: 0.82rem; color: #44403c; margin-bottom: 0.35rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .msg-card-bottom { display: flex; justify-content: space-between; align-items: center; }
        .msg-card-badges { display: flex; gap: 0.3rem; flex-wrap: wrap; }
        .msg-card-actions { display: flex; gap: 0.35rem; }
      }
    </style>
    <div class="card msg-desktop-table">
      <div class="table-container">
        <table>
          <thead><tr><th>Date</th><th>Guest</th><th>Lot</th><th>Subject</th><th>Type</th><th>Actions</th></tr></thead>
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
                  <button class="btn btn-sm btn-outline" onclick="viewMessageById(${m.id})">View</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteMessage(${m.id})">Del</button>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="6" class="text-center" style="padding:2rem;color:#78716c">No messages sent</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card msg-card-list">
      ${messages.length ? messages.map(m => `
        <div class="msg-card">
          <div class="msg-card-top">
            <span class="msg-card-guest">${m.first_name ? m.first_name + ' ' + m.last_name : 'All Tenants'}${m.lot_id ? ' <span style="font-weight:400;color:#78716c;font-size:0.72rem">Lot ' + m.lot_id + '</span>' : ''}</span>
            <span class="msg-card-date">${new Date(m.sent_date).toLocaleDateString()}</span>
          </div>
          <div class="msg-card-subject">${m.subject || '(no subject)'}</div>
          <div class="msg-card-bottom">
            <div class="msg-card-badges">
              <span class="badge badge-${m.message_type === 'urgent' ? 'danger' : m.message_type === 'reminder' ? 'warning' : 'info'}">${m.message_type}</span>
              ${m.is_broadcast ? '<span class="badge badge-gray">broadcast</span>' : ''}
            </div>
            <div class="msg-card-actions">
              <button class="btn btn-sm btn-outline" onclick="viewMessageById(${m.id})">View</button>
              <button class="btn btn-sm btn-danger" onclick="deleteMessage(${m.id})">Del</button>
            </div>
          </div>
        </div>
      `).join('') : '<div style="text-align:center;padding:2rem;color:#78716c">No messages sent</div>'}
    </div>
  `;
}

// --- Send Message (single tenant, all delivery methods) ---
async function showSendMessage() {
  const tenants = await API.get('/tenants');
  showModal('Send Message', `
    <form onsubmit="sendMessage(event)">
      <div class="form-group">
        <label>To Guest</label>
        <select name="tenant_id" required>
          <option value="">Select guest...</option>
          ${tenants.map(t => '<option value="' + t.id + '">' + (t.lot_id || '?') + ' - ' + t.first_name + ' ' + t.last_name + '</option>').join('')}
        </select>
      </div>
      <div class="form-group"><label>Subject</label><input name="subject" required></div>
      <div class="form-group"><label>Message</label><textarea name="body" rows="5" required></textarea></div>
      <div style="margin-bottom:1rem">
        <div style="font-size:0.72rem;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem">Delivery method</div>
        <div style="display:flex;flex-direction:column;gap:0.35rem">
          ${_msgDeliveryOption('msg-delivery', 'portal', '📋', 'Portal Only', 'Posts to tenant inbox (free)', true)}
          ${_msgDeliveryOption('msg-delivery', 'email', '📧', 'Email Only', 'Sends email (free)', false)}
          ${_msgDeliveryOption('msg-delivery', 'sms', '📱', 'SMS Only', 'Sends text message (Twilio charges)', false)}
          ${_msgDeliveryOption('msg-delivery', 'both', '📱📧', 'SMS + Email', 'Both channels (Twilio charges for SMS)', false)}
          ${_msgDeliveryOption('msg-delivery', 'record', '📝', 'Record Only', 'Log only, no delivery', false)}
        </div>
      </div>
      <button type="submit" class="btn btn-primary btn-full">Send Message</button>
    </form>
  `);
  _initDeliveryRadios('msg-delivery');
}

async function sendMessage(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const delivery = document.querySelector('input[name="msg-delivery"]:checked')?.value || 'portal';
  try {
    const r = await API.post('/messages', {
      tenant_id: parseInt(form.get('tenant_id')),
      subject: form.get('subject'),
      body: form.get('body'),
      message_type: 'notice',
      delivery_method: delivery,
      is_broadcast: false
    });
    closeModal();
    var parts = [];
    if (delivery === 'record') parts.push('Message recorded (not sent).');
    else if (delivery === 'portal') parts.push('Posted to tenant portal.');
    else {
      if (r.smsSent) parts.push('SMS sent.');
      if (r.smsFailed) parts.push('SMS failed.');
      if (r.emailSent) parts.push('Email sent.');
      if (r.emailFailed) parts.push('Email failed.');
      if (r.emailSkipped) parts.push('Email skipped (no email or opted out).');
      if (!parts.length) parts.push('Message saved.');
    }
    showStatusToast('OK', parts.join(' '));
    loadMessages();
  } catch (err) {
    alert('Send failed: ' + (err.message || 'unknown'));
  }
}

// --- Broadcast to All ---
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
      <div style="margin-bottom:1rem">
        <div style="font-size:0.72rem;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem">Delivery method</div>
        <div style="display:flex;flex-direction:column;gap:0.35rem">
          ${_msgDeliveryOption('bcast-delivery', 'portal', '📋', 'Portal Only', 'Posts to all tenant inboxes (free)', true)}
          ${_msgDeliveryOption('bcast-delivery', 'email', '📧', 'Email Only', 'Sends email to all tenants (free)', false)}
          ${_msgDeliveryOption('bcast-delivery', 'sms', '📱', 'SMS Only', 'Texts all tenants (Twilio charges)', false)}
          ${_msgDeliveryOption('bcast-delivery', 'both', '📱📧', 'SMS + Email', 'Both channels (Twilio charges for SMS)', false)}
          ${_msgDeliveryOption('bcast-delivery', 'record', '📝', 'Record Only', 'Log only, no delivery', false)}
        </div>
      </div>
      <p style="color:var(--warning);font-size:0.9rem">This will send to all active tenants.</p>
      <button type="submit" class="btn btn-warning btn-full mt-2">Send to All</button>
    </form>
  `);
  _initDeliveryRadios('bcast-delivery');
}

async function sendBroadcast(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const delivery = document.querySelector('input[name="bcast-delivery"]:checked')?.value || 'portal';
  try {
    const result = await API.post('/messages', {
      subject: form.get('subject'),
      body: form.get('body'),
      message_type: form.get('message_type'),
      delivery_method: delivery,
      is_broadcast: true
    });
    closeModal();
    let msg = `Broadcast recorded for ${result.sent} tenants.`;
    if (result.smsSent || result.smsFailed) msg += `\nSMS sent: ${result.smsSent || 0}, failed: ${result.smsFailed || 0}.`;
    if (result.emailSent || result.emailFailed) msg += `\nEmail sent: ${result.emailSent || 0}, failed: ${result.emailFailed || 0}.`;
    if (result.emailSkipped) msg += `\nEmail skipped: ${result.emailSkipped}`;
    alert(msg);
    loadMessages();
  } catch (err) {
    alert('Broadcast failed: ' + (err.message || 'unknown'));
  }
}

// --- View / Delete messages ---
function viewMessage(id, subject, body, tenant) {
  showModal(escapeHtml(subject || 'Message'), `
    <p><strong>To:</strong> ${escapeHtml(tenant)}</p>
    <hr style="margin:1rem 0">
    <div>${escapeHtml(body).replace(/&lt;br&gt;/g, '<br>')}</div>
  `);
}

function viewMessageById(id) {
  const m = _messagesCache.find(x => x.id === id);
  if (!m) return;
  const tenant = (m.first_name || 'All') + ' ' + (m.last_name || 'Tenants');
  viewMessage(id, m.subject, (m.body || '').replace(/\n/g, '<br>'), tenant);
}

async function deleteMessage(id) {
  if (!confirm('Delete this message?')) return;
  await API.del(`/messages/${id}`);
  loadMessages();
}

// --- Advanced Notification System (kept for API compatibility) ---
const MSG_TEMPLATES = {
  late_payment: { subject: 'Payment Reminder', message: 'Hi [name], your account at Anahuac RV Park has a balance due. Please pay at anrvpark.com or call 409-267-6603.' },
  weather_emergency: { subject: 'WEATHER EMERGENCY', message: 'URGENT - Anahuac RV Park: Please take necessary precautions for the incoming weather event. Secure outdoor items, stay indoors if possible. Call 409-267-6603 for assistance.' },
  power_outage: { subject: 'Power Outage Notice', message: 'Anahuac RV Park Notice: We are experiencing a power outage. Our team is working to restore power. We apologize for the inconvenience. Call 409-267-6603 for updates.' },
  general: { subject: 'Park Announcement', message: 'Anahuac RV Park: ' },
  custom: { subject: '', message: '' },
};

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

  const toast = showStatusToast('Sending', 'Sending notifications...', -1);
  try {
    const r = await API.post('/messages/broadcast-advanced', data);
    toast.update('OK', 'Notifications sent!');
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
  showModal('Share Guest Portal', `
    <p style="margin-bottom:1rem;font-size:0.9rem;color:var(--gray-500)">Send the portal link to guests via SMS so they can view their balance and pay online.</p>
    <div class="form-group">
      <label>Send To</label>
      <select id="portal-recipient" onchange="portalRecipientChanged()">
        <option value="">Select a guest...</option>
        <option value="ALL">ALL Active Guests</option>
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
    const toast = showStatusToast('Sending', 'Sending portal links...', -1);
    try {
      const r = await API.post('/messages/broadcast-advanced', {
        message_type: 'portal_invite',
        recipients: 'all',
        delivery: 'sms',
        subject: 'Guest Portal',
        message: msg.replace('[Name]', '[name]'),
      });
      toast.update('OK', 'Portal links sent!');
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
    const name = opt?.dataset?.name || 'Guest';
    const phone = opt?.dataset?.phone;
    if (!phone) { if (errEl) { errEl.textContent = 'This guest has no phone number.'; errEl.style.display = ''; } return; }

    const personalMsg = msg.replace('[Name]', name).replace('[name]', name);
    const toast = showStatusToast('Sending', `Sending to ${name}...`, -1);
    try {
      await API.post('/messages', {
        tenant_id: parseInt(sel.value),
        subject: 'Guest Portal Link',
        body: personalMsg,
        message_type: 'portal_invite',
        delivery_method: 'sms',
        is_broadcast: false,
      });
      toast.update('OK', `Portal link sent to ${name}!`);
      toast.hide(3000);
      closeModal();
      loadMessages();
    } catch (err) {
      toast.hide(0);
      alert('Failed: ' + (err.message || 'unknown'));
    }
  }
}
