/*
 * Anahuac RV Park — Quarter Requests (Admin)
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');
const pushService = require('../services/push-notifications');

router.use(authenticate);

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// List all quarter requests (with tenant info)
router.get('/', requireAdmin, (req, res) => {
  const status = req.query.status;
  let sql = `SELECT qr.*, t.first_name, t.last_name, t.lot_id, t.phone
    FROM quarter_requests qr LEFT JOIN tenants t ON qr.tenant_id = t.id`;
  const params = [];
  if (status && status !== 'all') { sql += ' WHERE qr.status = ?'; params.push(status); }
  sql += ' ORDER BY qr.created_at DESC LIMIT 100';
  try {
    res.json(db.prepare(sql).all(...params) || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pending requests only
router.get('/pending', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`SELECT qr.*, t.first_name, t.last_name, t.lot_id, t.phone
      FROM quarter_requests qr LEFT JOIN tenants t ON qr.tenant_id = t.id
      WHERE qr.status IN ('pending','confirmed') ORDER BY qr.created_at ASC`).all();
    res.json(rows || []);
  } catch { res.json([]); }
});

// Pending count (for dashboard badge)
router.get('/pending-count', requireAdmin, (req, res) => {
  try {
    const c = db.prepare("SELECT COUNT(*) as c FROM quarter_requests WHERE status = 'pending'").get()?.c || 0;
    res.json({ count: c });
  } catch { res.json({ count: 0 }); }
});

// Get single request with messages
router.get('/:id', requireAdmin, (req, res) => {
  try {
    const qr = db.prepare(`SELECT qr.*, t.first_name, t.last_name, t.lot_id, t.phone
      FROM quarter_requests qr LEFT JOIN tenants t ON qr.tenant_id = t.id WHERE qr.id = ?`).get(parseInt(req.params.id));
    if (!qr) return res.status(404).json({ error: 'Not found' });
    const messages = db.prepare('SELECT * FROM quarter_request_messages WHERE request_id = ? ORDER BY created_at ASC').all(qr.id);
    res.json({ ...qr, messages });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// Confirm request
router.post('/:id/confirm', requireAdmin, (req, res) => {
  const b = req.body || {};
  try {
    const qr = db.prepare('SELECT * FROM quarter_requests WHERE id = ?').get(parseInt(req.params.id));
    if (!qr) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE quarter_requests SET status = 'confirmed', admin_response = ?, admin_responded_at = CURRENT_TIMESTAMP,
      responded_by = ?, confirmed_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      b.message || 'Confirmed!', req.user.username || 'Admin', b.confirmed_time || '', qr.id
    );
    // Add as a message too
    db.prepare('INSERT INTO quarter_request_messages (request_id, sender_type, sender_name, message) VALUES (?,?,?,?)').run(
      qr.id, 'admin', 'Park Management', b.message || 'Confirmed!'
    );
    // Notify tenant
    try { pushService.notifyTenant(qr.tenant_id, { type: 'quarters', title: '\ud83e\ude99 Quarter Request \u2014 Confirmed!', body: b.message || 'Your quarter request has been confirmed.', url: '/portal', priority: 'normal' }); } catch {}
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Decline request
router.post('/:id/decline', requireAdmin, (req, res) => {
  const b = req.body || {};
  try {
    const qr = db.prepare('SELECT * FROM quarter_requests WHERE id = ?').get(parseInt(req.params.id));
    if (!qr) return res.status(404).json({ error: 'Not found' });
    const reason = b.message || b.reason || 'Unable to fulfill at this time.';
    db.prepare(`UPDATE quarter_requests SET status = 'declined', admin_response = ?, admin_responded_at = CURRENT_TIMESTAMP,
      responded_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      reason, req.user.username || 'Admin', qr.id
    );
    db.prepare('INSERT INTO quarter_request_messages (request_id, sender_type, sender_name, message) VALUES (?,?,?,?)').run(
      qr.id, 'admin', 'Park Management', reason
    );
    try { pushService.notifyTenant(qr.tenant_id, { type: 'quarters', title: '\ud83e\ude99 Quarter Request \u2014 Update', body: reason, url: '/portal', priority: 'normal' }); } catch {}
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark as completed
router.post('/:id/complete', requireAdmin, (req, res) => {
  try {
    const qr = db.prepare('SELECT * FROM quarter_requests WHERE id = ?').get(parseInt(req.params.id));
    if (!qr) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE quarter_requests SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(qr.id);
    try { pushService.notifyTenant(qr.tenant_id, { type: 'quarters', title: '\ud83e\ude99 Quarter Exchange Complete', body: 'Your quarter exchange has been marked as complete. Thanks!', url: '/portal', priority: 'normal' }); } catch {}
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin sends message on thread
router.post('/:id/messages', requireAdmin, (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
  try {
    const qr = db.prepare('SELECT * FROM quarter_requests WHERE id = ?').get(parseInt(req.params.id));
    if (!qr) return res.status(404).json({ error: 'Not found' });
    db.prepare('INSERT INTO quarter_request_messages (request_id, sender_type, sender_name, message) VALUES (?,?,?,?)').run(
      qr.id, 'admin', req.user.username || 'Park Management', message.trim().substring(0, 500)
    );
    try { pushService.notifyTenant(qr.tenant_id, { type: 'quarters', title: '\ud83e\ude99 Message from Park Management', body: message.trim().substring(0, 100), url: '/portal', priority: 'normal' }); } catch {}
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to send message' }); }
});

module.exports = router;
