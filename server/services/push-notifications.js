/*
 * Anahuac RV Park — Push Notification Service
 * Handles sending web push notifications, quiet hours, and queuing.
 */
const { db } = require('../database');

let webpush;
try {
  webpush = require('web-push');
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:anrvpark@gmail.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    console.log('[push] web-push configured');
  } else {
    console.log('[push] VAPID keys not set — push notifications disabled');
    webpush = null;
  }
} catch (e) {
  console.log('[push] web-push not installed �� push notifications disabled');
  webpush = null;
}

// Check if current time is in quiet hours for a tenant
function isInQuietHours(prefs) {
  if (!prefs || !prefs.quiet_hours_enabled) return false;
  const now = new Date();
  const hour = now.getHours();
  const start = prefs.quiet_start_hour != null ? prefs.quiet_start_hour : 22;
  const end = prefs.quiet_end_hour != null ? prefs.quiet_end_hour : 7;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // crosses midnight
}

function getPreferences(tenantId) {
  try {
    return db.prepare('SELECT * FROM notification_preferences WHERE tenant_id = ?').get(tenantId);
  } catch { return null; }
}

// Check if a tenant wants this notification type
function wantsNotificationType(prefs, type) {
  if (!prefs || !prefs.enabled) return prefs ? prefs.enabled !== 0 : true; // default enabled
  const map = {
    invoice: 'invoices', payment: 'payments', community: 'community',
    comment: 'community', reaction: 'community',
    maintenance: 'maintenance', announcement: 'announcements',
    weather: 'weather_alerts',
  };
  const col = map[type];
  if (col && prefs[col] === 0) return false;
  return true;
}

// Send push to a specific subscription endpoint
async function sendPush(subscription, payload) {
  if (!webpush) return false;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — remove it
      try { db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(subscription.endpoint); } catch {}
      return false;
    }
    console.error('[push] send error:', err.message);
    return false;
  }
}

// Core: send notification to a specific tenant
async function notifyTenant(tenantId, { type, title, body, url, priority }) {
  priority = priority || 'normal';

  // Save to notifications table (inbox)
  let notifId;
  try {
    const result = db.prepare(
      'INSERT INTO notifications (tenant_id, is_admin, type, title, body, url, priority) VALUES (?,0,?,?,?,?,?)'
    ).run(tenantId, type, title, body, url || '/portal', priority);
    notifId = result.lastInsertRowid;
  } catch (e) {
    console.error('[push] save notification error:', e.message);
  }

  const prefs = getPreferences(tenantId);

  // Check preference for this type (weather/critical always goes through)
  if (priority !== 'critical' && !wantsNotificationType(prefs, type)) return;

  // Check quiet hours (critical bypasses)
  if (priority !== 'critical' && isInQuietHours(prefs)) {
    // Leave is_sent = 0 — will be sent by morning flush
    return;
  }

  // Get unread count for badge
  let badgeCount = 0;
  try {
    badgeCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE tenant_id = ? AND is_read = 0').get(tenantId)?.c || 0;
  } catch {}

  // Get all subscriptions for this tenant
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE tenant_id = ? AND is_admin = 0').all(tenantId);

  for (const sub of subs) {
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } };
    const sent = await sendPush(pushSub, { title, body, url: url || '/portal', tag: type, priority, badge_count: badgeCount, icon: '/icons/icon-192x192.png' });
    if (sent) {
      try {
        db.prepare('UPDATE push_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(sub.id);
        if (notifId) db.prepare('UPDATE notifications SET is_sent = 1, sent_at = CURRENT_TIMESTAMP WHERE id = ?').run(notifId);
      } catch {}
    }
  }
}

// Notify all active tenants (for announcements, weather alerts)
async function notifyAllTenants({ type, title, body, url, priority }) {
  try {
    const tenants = db.prepare('SELECT id FROM tenants WHERE is_active = 1').all();
    for (const t of tenants) {
      await notifyTenant(t.id, { type, title, body, url, priority });
    }
  } catch (e) {
    console.error('[push] notifyAllTenants error:', e.message);
  }
}

// Notify admin(s) — sends to all admin push subscriptions
async function notifyAdmin({ type, title, body, url, priority }) {
  priority = priority || 'normal';

  // Save to notifications table as admin notification
  try {
    db.prepare(
      'INSERT INTO notifications (tenant_id, is_admin, type, title, body, url, priority, is_sent, sent_at) VALUES (NULL,1,?,?,?,?,?,1,CURRENT_TIMESTAMP)'
    ).run(type, title, body, url || '/', priority);
  } catch {}

  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE is_admin = 1').all();
  for (const sub of subs) {
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } };
    await sendPush(pushSub, { title, body, url: url || '/', tag: type, priority, icon: '/icons/icon-192x192.png' });
  }
}

// Flush queued notifications (those saved during quiet hours)
// Called by a morning job.
async function flushQueuedNotifications() {
  try {
    const queued = db.prepare('SELECT * FROM notifications WHERE is_sent = 0 AND is_read = 0 AND created_at > datetime("now", "-24 hours")').all();
    for (const n of queued) {
      if (n.is_admin) continue;
      const prefs = getPreferences(n.tenant_id);
      if (isInQuietHours(prefs)) continue; // still in quiet hours

      let badgeCount = 0;
      try {
        badgeCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE tenant_id = ? AND is_read = 0').get(n.tenant_id)?.c || 0;
      } catch {}

      const subs = db.prepare('SELECT * FROM push_subscriptions WHERE tenant_id = ? AND is_admin = 0').all(n.tenant_id);
      for (const sub of subs) {
        const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } };
        await sendPush(pushSub, { title: n.title, body: n.body, url: n.url, tag: n.type, priority: n.priority, badge_count: badgeCount });
      }
      db.prepare('UPDATE notifications SET is_sent = 1, sent_at = CURRENT_TIMESTAMP WHERE id = ?').run(n.id);
    }
  } catch (e) {
    console.error('[push] flush error:', e.message);
  }
}

module.exports = { notifyTenant, notifyAllTenants, notifyAdmin, flushQueuedNotifications, isInQuietHours };
