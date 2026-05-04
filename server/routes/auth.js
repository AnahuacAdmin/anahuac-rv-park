/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../database');
const { SECRET, TOKEN_TTL } = require('../middleware');

// TEMPORARY one-time emergency password reset — REMOVE after use
router.post('/emergency-reset-xK9m7Q', (req, res) => {
  const key = req.body?.key;
  if (key !== 'AnRV-EmReset-2026-05-04') return res.status(403).json({ error: 'Forbidden' });
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!user) return res.status(404).json({ error: 'Admin user not found' });
  const hash = bcrypt.hashSync('TempReset2026!', 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
  res.json({ success: true, message: 'Admin password reset. REMOVE THIS ENDPOINT NOW.' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Invalid credentials' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// Password recovery via secret PIN.
// NOTE: passwords are bcrypt-hashed and cannot be retrieved — only reset.
router.post('/recover', (req, res) => {
  const { username, pin, newPassword } = req.body;
  if (typeof username !== 'string' || typeof pin !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Username, PIN, and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const pinRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('recovery_pin');
  if (!pinRow || pin !== pinRow.value) {
    return res.status(401).json({ error: 'Invalid recovery PIN' });
  }
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
  res.json({ success: true });
});

// Change password (requires valid JWT)
const { authenticate } = require('../middleware');
router.post('/change-password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
  res.json({ success: true });
});

module.exports = router;
