const { db, initializeDatabase } = require('./server/database');
(async () => {
  await initializeDatabase();
  const rows = db.prepare(
    "SELECT row_letter || lot_number AS lot_id, status FROM lots ORDER BY row_letter, lot_number"
  ).all();
  console.table(rows);
  console.log('TOTAL ROWS:', rows.length);
  setTimeout(() => process.exit(0), 300);
})();
