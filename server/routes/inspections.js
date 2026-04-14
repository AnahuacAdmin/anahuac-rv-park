/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

// Public endpoint for tenant portal — uses portal JWT
router.get('/my-history', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const jwt = require('jsonwebtoken');
    const { SECRET } = require('../middleware');
    const user = jwt.verify(token, SECRET);
    if (user.role !== 'tenant') return res.status(403).json({ error: 'Tenant access only' });
    const rows = db.prepare(`
      SELECT id, lot_id, notes, severity, status, created_at, sent_at, resolved_at, fine_amount
      FROM lot_inspections WHERE tenant_id = ? AND status != 'draft' ORDER BY created_at DESC LIMIT 20
    `).all(user.id);
    res.json(rows);
  } catch { res.status(401).json({ error: 'Invalid token' }); }
});

// Admin-only routes
router.use(authenticate);
router.use(requireAdmin);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, t.first_name, t.last_name
    FROM lot_inspections i
    LEFT JOIN tenants t ON i.tenant_id = t.id
    ORDER BY i.created_at DESC
  `).all();
  res.json(rows);
});

router.get('/:id/photo', (req, res) => {
  const row = db.prepare('SELECT photo FROM lot_inspections WHERE id = ?').get(req.params.id);
  if (!row?.photo) return res.status(404).json({ error: 'No photo' });
  const buf = Buffer.from(row.photo, 'base64');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(buf);
});

router.post('/', (req, res) => {
  const { tenant_id, lot_id, photo, notes, severity } = req.body || {};
  if (!tenant_id || !lot_id) return res.status(400).json({ error: 'Tenant and lot required' });
  const validSev = ['record', 'reminder', 'warning', 'fine'];
  const sev = validSev.includes(severity) ? severity : 'record';
  const result = db.prepare(`
    INSERT INTO lot_inspections (tenant_id, lot_id, photo, notes, severity, status)
    VALUES (?, ?, ?, ?, ?, 'draft')
  `).run(tenant_id, lot_id, photo || null, notes || '', sev);
  res.json({ id: result.lastInsertRowid });
});

router.post('/:id/send', (req, res) => {
  const insp = db.prepare(`
    SELECT i.*, t.first_name, t.last_name, t.lot_id as t_lot
    FROM lot_inspections i
    LEFT JOIN tenants t ON i.tenant_id = t.id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!insp) return res.status(404).json({ error: 'Inspection not found' });
  if (insp.status !== 'draft') return res.status(400).json({ error: 'Already sent' });

  const name = (insp.first_name || '') + ' ' + (insp.last_name || '');
  const lot = insp.lot_id || insp.t_lot || '?';
  let msgBody = '';
  let fineAmount = 0;

  if (insp.severity === 'record') {
    // No notification — just mark as sent
  } else if (insp.severity === 'reminder') {
    msgBody = `Hi ${insp.first_name || 'there'}! We noticed your lot ${lot} could use some attention. Please tidy up when you get a chance. Thanks! — Anahuac RV Park Management 🐊`;
  } else if (insp.severity === 'warning') {
    msgBody = `⚠️ LOT CLEANLINESS NOTICE\nHi ${insp.first_name || 'there'}, during a recent inspection of Lot ${lot} we found it needs attention.\nPlease clean up within 3 days to avoid a $25 fine.\nIf you have questions call 409-267-6603.`;
  } else if (insp.severity === 'fine') {
    fineAmount = 25;
    msgBody = `💰 LOT CLEANLINESS FINE\nA $25 cleanliness fine has been added to your account for Lot ${lot}.\nPlease clean up immediately.\nQuestions? Call 409-267-6603.`;

    // Add fine as an invoice charge
    try {
      const invNum = 'FINE-' + Date.now().toString(36).toUpperCase();
      const today = new Date().toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO invoices (tenant_id, lot_id, invoice_number, invoice_date, due_date, other_charges, other_description, subtotal, total_amount, balance_due, status, notes)
        VALUES (?, ?, ?, ?, ?, 25, 'Lot Cleanliness Fine', 25, 25, 25, 'pending', ?)
      `).run(insp.tenant_id, lot, invNum, today, today, 'Lot cleanliness fine from inspection');
    } catch (e) { console.error('[inspections] fine invoice failed:', e.message); }
  }

  // Post portal message if applicable
  if (msgBody && insp.tenant_id) {
    try {
      db.prepare('INSERT INTO messages (tenant_id, subject, body, message_type, is_broadcast) VALUES (?, ?, ?, ?, 0)')
        .run(insp.tenant_id, 'Lot Inspection: ' + insp.severity.charAt(0).toUpperCase() + insp.severity.slice(1), msgBody, 'lot_inspection');
    } catch (e) { console.error('[inspections] message failed:', e.message); }
  }

  // Update inspection status
  db.prepare("UPDATE lot_inspections SET status = 'sent', sent_at = datetime('now'), fine_amount = ?, fine_added = ? WHERE id = ?")
    .run(fineAmount, fineAmount > 0 ? 1 : 0, insp.id);

  res.json({ success: true, severity: insp.severity, messageSent: !!msgBody, fineAdded: fineAmount > 0 });
});

router.post('/:id/resolve', (req, res) => {
  db.prepare("UPDATE lot_inspections SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

router.put('/:id', (req, res) => {
  const { notes, severity } = req.body || {};
  const validSev = ['record', 'reminder', 'warning', 'fine'];
  const updates = [];
  const params = [];
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (severity && validSev.includes(severity)) { updates.push('severity = ?'); params.push(severity); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE lot_inspections SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  // Only allow deleting drafts
  const insp = db.prepare('SELECT status FROM lot_inspections WHERE id = ?').get(req.params.id);
  if (!insp) return res.status(404).json({ error: 'Not found' });
  if (insp.status !== 'draft') return res.status(400).json({ error: 'Cannot delete sent inspections' });
  db.prepare('DELETE FROM lot_inspections WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
