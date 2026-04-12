/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const { db, initializeDatabase } = require('./server/database');

(async () => {
  await initializeDatabase();

  // Note: lots table has (id, row_letter, lot_number, status, ...). There is no
  // tenant_name column — tenants live in their own table joined by lot_id.
  const rows = db.prepare(`
    SELECT l.id AS lot, l.row_letter, l.lot_number, l.status,
           CASE WHEN t.id IS NULL THEN NULL
                ELSE t.first_name || ' ' || t.last_name END AS tenant_name
    FROM lots l
    LEFT JOIN tenants t ON t.lot_id = l.id AND t.is_active = 1
    ORDER BY l.row_letter, l.lot_number
  `).all();
  console.table(rows);

  const total = db.prepare('SELECT COUNT(*) AS total FROM lots').get();
  console.log('TOTAL:', total);

  setTimeout(() => process.exit(0), 500);
})();
