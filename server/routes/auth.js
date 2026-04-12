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

module.exports = router;
