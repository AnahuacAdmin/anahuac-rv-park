/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

// List all documents with optional filters
router.get('/', (req, res) => {
  var q = req.query;
  var sql = `SELECT d.*, t.first_name, t.last_name FROM tenant_documents d
    LEFT JOIN tenants t ON d.tenant_id = t.id WHERE 1=1`;
  var params = [];

  if (q.tenant_id) { sql += ' AND d.tenant_id = ?'; params.push(q.tenant_id); }
  if (q.lot_id) { sql += ' AND d.lot_id = ?'; params.push(q.lot_id); }
  if (q.doc_type && q.doc_type !== 'all') { sql += ' AND d.doc_type = ?'; params.push(q.doc_type); }
  if (q.search) {
    sql += " AND (t.first_name || ' ' || t.last_name LIKE ? OR d.lot_id LIKE ? OR d.doc_name LIKE ?)";
    var s = '%' + q.search + '%';
    params.push(s, s, s);
  }
  sql += ' ORDER BY d.uploaded_at DESC';

  // Don't return file_data in list — too large
  var rows = db.prepare(sql).all(...params);
  rows.forEach(function(r) { r.has_file = !!r.file_data; delete r.file_data; });
  res.json(rows);
});

// Get tenants with missing documents
router.get('/missing', (req, res) => {
  var tenants = db.prepare(`
    SELECT t.id, t.first_name, t.last_name, t.lot_id,
      (SELECT COUNT(*) FROM tenant_documents d WHERE d.tenant_id = t.id) as doc_count
    FROM tenants t WHERE t.is_active = 1
    HAVING doc_count = 0
    ORDER BY t.lot_id
  `).all();
  res.json(tenants);
});

// Get documents for a specific tenant
router.get('/tenant/:tenantId', (req, res) => {
  var rows = db.prepare('SELECT id, tenant_id, lot_id, doc_type, doc_name, file_type, uploaded_at FROM tenant_documents WHERE tenant_id = ? ORDER BY uploaded_at DESC').all(req.params.tenantId);
  res.json(rows);
});

// Download a specific document
router.get('/:id/download', (req, res) => {
  var doc = db.prepare('SELECT * FROM tenant_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!doc.file_data) return res.status(404).json({ error: 'No file data' });

  var buf = Buffer.from(doc.file_data, 'base64');
  var mime = doc.file_type || 'application/octet-stream';
  res.set('Content-Type', mime);
  res.set('Content-Disposition', 'inline; filename="' + (doc.doc_name || 'document') + '"');
  res.send(buf);
});

// Upload a document
router.post('/', (req, res) => {
  var b = req.body || {};
  if (!b.tenant_id || !b.doc_name) return res.status(400).json({ error: 'tenant_id and doc_name required' });

  var result = db.prepare(`
    INSERT INTO tenant_documents (tenant_id, lot_id, doc_type, doc_name, file_data, file_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(b.tenant_id, b.lot_id || null, b.doc_type || 'other', b.doc_name, b.file_data || null, b.file_type || null);

  res.json({ id: result.lastInsertRowid });
});

// Delete a document
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tenant_documents WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
