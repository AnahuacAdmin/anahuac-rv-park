/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
// Backfill real April 2026 meter face values.
// Usage:  node backfill-meters.js
// Honors DB_PATH env var (same as the server).
//
// For each lot, finds the meter_readings row whose reading_date falls in
// 2026-04 (preferring the latest), and updates previous_reading,
// current_reading, kwh_used, and electric_charge. If no April row exists,
// inserts one dated 2026-04-01 linked to the active tenant for that lot.

const { db, initializeDatabase } = require('./server/database');

const READINGS = {
  A2: [14954, 14954],
  A3: [57336, 57884],
  A4: [37435, 37641],
  A5: [69085, 69218],
  B1: [33714, 34012],
  B2: [20855, 21720],
  B4: [49812, 50441],
  C3: [93636, 94155],
  D3: [61672, 62254],
  E1: [65197, 65815],
  E2: [26736, 27402],
  E3: [32992, 32992],
  E4: [11416, 11830],
  F1: [18035, 18453],
  F2: [10998, 11203],
  F3: [53125, 53622],
  F5: [62115, 62560],
  G1: [59887, 60238],
  G2: [45992, 46490],
  G3: [46461, 46952],
  G4: [49182, 49589],
  G5: [25073, 25587],
  H2: [36507, 36874],
  H3: [33235, 33888],
  H4: [44260, 45493],
  H5: [65910, 67051],
  H6: [21953, 22429],
};

const PERIOD_START = '2026-04-01';
const PERIOD_END   = '2026-04-30';

(async () => {
  try {
    await initializeDatabase();

    const rateRow = db.prepare("SELECT value FROM settings WHERE key = 'electric_rate'").get();
    const rate = parseFloat(rateRow?.value ?? 0.15);

    let updated = 0, inserted = 0, skipped = 0;

    for (const [lotId, [prev, curr]] of Object.entries(READINGS)) {
      const kwh = curr - prev;
      const charge = +(kwh * rate).toFixed(2);

      // Try to find an existing April reading for this lot.
      const existing = db.prepare(
        `SELECT id FROM meter_readings
         WHERE lot_id = ? AND reading_date BETWEEN ? AND ?
         ORDER BY reading_date DESC, id DESC LIMIT 1`
      ).get(lotId, PERIOD_START, PERIOD_END);

      if (existing) {
        db.prepare(
          `UPDATE meter_readings
           SET previous_reading = ?, current_reading = ?, kwh_used = ?,
               rate_per_kwh = ?, electric_charge = ?
           WHERE id = ?`
        ).run(prev, curr, kwh, rate, charge, existing.id);
        updated++;
        console.log(`UPDATED  ${lotId}  prev=${prev}  curr=${curr}  kWh=${kwh}  $${charge}`);
      } else {
        // No April row — insert one. Need an active tenant for the lot.
        const tenant = db.prepare(
          `SELECT id FROM tenants WHERE lot_id = ? AND is_active = 1 LIMIT 1`
        ).get(lotId);
        if (!tenant) {
          console.log(`SKIPPED  ${lotId}  (no active tenant on this lot)`);
          skipped++;
          continue;
        }
        db.prepare(
          `INSERT INTO meter_readings
             (lot_id, tenant_id, reading_date, previous_reading, current_reading,
              kwh_used, rate_per_kwh, electric_charge)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(lotId, tenant.id, PERIOD_START, prev, curr, kwh, rate, charge);
        inserted++;
        console.log(`INSERTED ${lotId}  prev=${prev}  curr=${curr}  kWh=${kwh}  $${charge}`);
      }
    }

    console.log(`\nDone. updated=${updated}  inserted=${inserted}  skipped=${skipped}`);
    // Let the auto-save interval flush before exit.
    setTimeout(() => process.exit(0), 800);
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  }
})();
