/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
// Creates (or resets) the admin user in the configured database.
// Usage:  node create-admin.js
// Honors DB_PATH env var (same as the server).

const bcrypt = require('bcryptjs');
const { db, initializeDatabase } = require('./server/database');

const USERNAME = 'admin';
const PASSWORD = 'anahuac2026';

(async () => {
  try {
    await initializeDatabase();

    const hash = bcrypt.hashSync(PASSWORD, 10);
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME);

    if (existing) {
      db.prepare('UPDATE users SET password = ?, role = ? WHERE username = ?')
        .run(hash, 'admin', USERNAME);
      console.log(`Admin user "${USERNAME}" already existed — password reset.`);
    } else {
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
        .run(USERNAME, hash, 'admin');
      console.log(`Admin user "${USERNAME}" created.`);
    }

    // Give the auto-save interval a moment to flush, then exit cleanly.
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    console.error('Failed to create admin user:', err);
    process.exit(1);
  }
})();
