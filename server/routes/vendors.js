/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */
const router = require('express').Router();
const crypto = require('crypto');
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

// AES-256-GCM encryption for vendor passwords
const ENC_KEY = process.env.VENDOR_ENC_KEY || crypto.createHash('sha256').update(process.env.JWT_SECRET || 'anahuac-rv-park-default-key').digest();

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + encrypted;
}

function decrypt(data) {
  if (!data) return null;
  try {
    const parts = data.split(':');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch { return null; }
}

const str = (v) => (v === undefined || v === null || v === '') ? null : String(v).slice(0, 500);

router.get('/', (req, res) => {
  const vendors = db.prepare('SELECT * FROM vendors ORDER BY is_favorite DESC, name ASC').all();
  // Strip encrypted passwords from list response, add has_credentials flag
  vendors.forEach(v => {
    v.has_credentials = !!(v.username || v.password_encrypted);
    v.has_password = !!v.password_encrypted;
    delete v.password_encrypted;
  });
  res.json(vendors);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name is required' });
  const encPass = b.password ? encrypt(b.password) : null;
  const result = db.prepare(`
    INSERT INTO vendors (name, category, phone, email, website, address, city, state, zip, notes, is_favorite,
      account_number, login_url, username, password_encrypted, autopay_enrolled, payment_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.name, str(b.category) || 'Other', str(b.phone), str(b.email), str(b.website),
    str(b.address), str(b.city), str(b.state) || 'TX', str(b.zip), str(b.notes), b.is_favorite ? 1 : 0,
    str(b.account_number), str(b.login_url), str(b.username), encPass, b.autopay_enrolled ? 1 : 0, str(b.payment_method));
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const b = req.body || {};
  // Only update password if explicitly provided
  if (b.password) {
    const encPass = encrypt(b.password);
    db.prepare(`UPDATE vendors SET name=?, category=?, phone=?, email=?, website=?, address=?, city=?, state=?, zip=?, notes=?, is_favorite=?,
      account_number=?, login_url=?, username=?, password_encrypted=?, autopay_enrolled=?, payment_method=? WHERE id=?`
    ).run(b.name, str(b.category) || 'Other', str(b.phone), str(b.email), str(b.website),
      str(b.address), str(b.city), str(b.state) || 'TX', str(b.zip), str(b.notes), b.is_favorite ? 1 : 0,
      str(b.account_number), str(b.login_url), str(b.username), encPass, b.autopay_enrolled ? 1 : 0, str(b.payment_method), req.params.id);
  } else {
    db.prepare(`UPDATE vendors SET name=?, category=?, phone=?, email=?, website=?, address=?, city=?, state=?, zip=?, notes=?, is_favorite=?,
      account_number=?, login_url=?, username=?, autopay_enrolled=?, payment_method=? WHERE id=?`
    ).run(b.name, str(b.category) || 'Other', str(b.phone), str(b.email), str(b.website),
      str(b.address), str(b.city), str(b.state) || 'TX', str(b.zip), str(b.notes), b.is_favorite ? 1 : 0,
      str(b.account_number), str(b.login_url), str(b.username), b.autopay_enrolled ? 1 : 0, str(b.payment_method), req.params.id);
  }
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM vendors WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.post('/:id/favorite', (req, res) => {
  const vendor = db.prepare('SELECT is_favorite FROM vendors WHERE id=?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE vendors SET is_favorite=? WHERE id=?').run(vendor.is_favorite ? 0 : 1, req.params.id);
  res.json({ is_favorite: !vendor.is_favorite });
});

router.post('/:id/used', (req, res) => {
  db.prepare("UPDATE vendors SET last_used=date('now') WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// Get decrypted credentials (admin only — already enforced by middleware)
router.get('/:id/credentials', (req, res) => {
  const v = db.prepare('SELECT username, password_encrypted, login_url, account_number FROM vendors WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  res.json({
    username: v.username,
    password: decrypt(v.password_encrypted),
    login_url: v.login_url,
    account_number: v.account_number,
  });
});

// Payment history for a vendor (expenses linked to this vendor)
router.get('/:id/payments', (req, res) => {
  const vendor = db.prepare('SELECT name FROM vendors WHERE id=?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  // Match by vendor_id or vendor name text
  const payments = db.prepare(`
    SELECT id, expense_date, amount, category, description, paid_by, status
    FROM expenses WHERE vendor_id = ? OR vendor = ?
    ORDER BY expense_date DESC LIMIT 50
  `).all(req.params.id, vendor.name);
  const total = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const avg = payments.length > 0 ? total / payments.length : 0;
  res.json({ payments, total, average: avg, count: payments.length });
});

module.exports = router;
