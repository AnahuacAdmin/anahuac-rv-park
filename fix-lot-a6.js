const { db, initializeDatabase } = require('./server/database');

(async () => {
  await initializeDatabase();

  // Delete any tenant assignment / readings / invoices tied to A6 first (defensive)
  db.prepare("DELETE FROM meter_readings WHERE lot_id = 'A6'").run();
  db.prepare("UPDATE tenants SET lot_id = NULL WHERE lot_id = 'A6'").run();
  const r = db.prepare("DELETE FROM lots WHERE id = 'A6'").run();
  console.log(`Deleted A6: ${r.changes} row(s)`);

  const total = db.prepare('SELECT COUNT(*) c FROM lots').get().c;
  const byStatus = db.prepare('SELECT status, COUNT(*) c FROM lots GROUP BY status').all();
  console.log(`Total lots: ${total}`);
  console.log('By status:', byStatus);

  const all = db.prepare('SELECT id, status FROM lots ORDER BY id').all();
  const groups = { occupied: [], vacant: [], owner_reserved: [], reserved: [] };
  all.forEach(l => { (groups[l.status] = groups[l.status] || []).push(l.id); });
  for (const k of Object.keys(groups)) console.log(`${k} (${groups[k].length}):`, groups[k].join(', '));

  setTimeout(() => process.exit(0), 1000);
})();
