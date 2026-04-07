const { db, initializeDatabase } = require('./server/database');

const READING_DATE = '2026-04-01';
const prevs = [
  ['A3',57336],['A4',37435],['A5',69085],['B2',20855],['B4',49812],
  ['C3',93636],['D3',61672],['E1',65197],['E2',26736],['E3',32992],
  ['E4',11416],['F1',18035],['F2',10998],['F3',53125],['F5',62115],
  ['G1',59887],['G2',45992],['G3',46461],['G4',49182],['G5',25073],
  ['H2',36507],['H3',33235],['H4',44260],['H5',65910],['H6',21953],
];

(async () => {
  await initializeDatabase();
  let updated = 0;
  for (const [lot, prev] of prevs) {
    const r = db.prepare('UPDATE meter_readings SET previous_reading = ? WHERE lot_id = ? AND reading_date = ?')
      .run(prev, lot, READING_DATE);
    if (r.changes) updated++;
  }
  console.log(`Previous readings updated: ${updated}`);
  setTimeout(() => process.exit(0), 1000);
})();
