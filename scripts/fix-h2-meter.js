/*
 * Fix Ezequiel Arellano (H2) meter reading: set final reading to 36874
 */
const { db, initializeDatabase, saveDb } = require('../server/database');

initializeDatabase().then(() => {
  console.log('[fix-h2-meter] Database initialized');

  // Update H2 April meter reading
  const result = db.prepare(
    "UPDATE meter_readings SET current_reading = ?, kwh_used = ?, electric_charge = ? WHERE lot_id = ? AND reading_date LIKE ?"
  ).run(36874, 367, 55.05, 'H2', '2026-04%');
  console.log('Meter updated:', result.changes, 'row(s)');

  // Verify
  const r = db.prepare("SELECT * FROM meter_readings WHERE lot_id = 'H2' AND reading_date LIKE '2026-04%'").get();
  if (r) {
    console.log('H2 meter:', r.previous_reading, '->', r.current_reading, '=', r.kwh_used, 'kWh = $' + r.electric_charge);
  } else {
    console.log('WARNING: No H2 meter reading found for April 2026');
  }

  saveDb();
  console.log('[fix-h2-meter] DONE');
  process.exit(0);
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
