/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
// Direct SQL update of April 2026 meter readings.
const { db, initializeDatabase } = require('./server/database');

const RATE = 0.15;
const READING_DATE = '2026-04-01';

const data = [
  ['A2', 0, 14954, 14954],
  ['A3', 548, 57336, 57884],
  ['A4', 206, 37435, 37641],
  ['A5', 133, 69085, 69218],
  ['B1', 298, 33714, 34012],
  ['B2', 865, 20855, 21720],
  ['B4', 629, 49812, 50441],
  ['C3', 519, 93636, 94155],
  ['D3', 582, 61672, 62254],
  ['E1', 618, 65197, 65815],
  ['E2', 666, 26736, 27402],
  ['E3', 0, 32992, 32992],
  ['E4', 414, 11416, 11830],
  ['F1', 418, 18035, 18453],
  ['F2', 205, 10998, 11203],
  ['F3', 497, 53125, 53622],
  ['F5', 445, 62115, 62560],
  ['G1', 351, 59887, 60238],
  ['G2', 498, 45992, 46490],
  ['G3', 491, 46461, 46952],
  ['G4', 407, 49182, 49589],
  ['G5', 514, 25073, 25587],
  ['H2', 367, 36507, 36874],
  ['H3', 653, 33235, 33888],
  ['H4', 1233, 44260, 45493],
  ['H5', 1141, 65910, 67051],
  ['H6', 476, 21953, 22429],
];

(async () => {
  await initializeDatabase();
  let updated = 0, inserted = 0;

  for (const [lot, kwh, prev, curr] of data) {
    const charge = kwh * RATE;
    const existing = db.prepare(
      'SELECT id FROM meter_readings WHERE lot_id = ? AND reading_date = ?'
    ).get(lot, READING_DATE);

    if (existing) {
      db.prepare(
        `UPDATE meter_readings
         SET previous_reading = ?, current_reading = ?, kwh_used = ?,
             rate_per_kwh = ?, electric_charge = ?
         WHERE id = ?`
      ).run(prev, curr, kwh, RATE, charge, existing.id);
      updated++;
    } else {
      const tenant = db.prepare(
        'SELECT id FROM tenants WHERE lot_id = ? AND is_active = 1'
      ).get(lot);
      db.prepare(
        `INSERT INTO meter_readings
         (lot_id, tenant_id, reading_date, previous_reading, current_reading,
          kwh_used, rate_per_kwh, electric_charge)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(lot, tenant?.id || null, READING_DATE, prev, curr, kwh, RATE, charge);
      inserted++;
    }
  }

  console.log(`April 2026 meter readings — updated: ${updated}, inserted: ${inserted}`);
  setTimeout(() => process.exit(0), 1000);
})();
