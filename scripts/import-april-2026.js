/**
 * Anahuac RV Park — April 2026 Data Import Script
 *
 * Usage: node scripts/import-april-2026.js
 *
 * This script imports tenant and lot data for April 2026.
 * Run from the project root directory.
 *
 * NOTE: Replace the placeholder data below with actual import data.
 */

const { initializeDatabase, db: getDb } = require('../server/database');

async function run() {
  await initializeDatabase();
  const { db } = require('../server/database');

  console.log('=== April 2026 Import ===');
  console.log('Database ready.');

  // Count current state
  var tenants = db.prepare('SELECT COUNT(*) as c FROM tenants WHERE is_active=1').get().c;
  var lots = db.prepare('SELECT COUNT(*) as c FROM lots').get().c;
  console.log('Current: ' + tenants + ' active tenants, ' + lots + ' lots');

  // TODO: Add import data here
  // Example:
  // db.prepare('UPDATE tenants SET deposit_waived=1 WHERE id=?').run(tenantId);
  // db.prepare('INSERT INTO tenants (...) VALUES (...)').run(...);

  console.log('Import complete.');
  process.exit(0);
}

run().catch(function(err) {
  console.error('Import failed:', err);
  process.exit(1);
});
