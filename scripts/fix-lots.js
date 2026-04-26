/*
 * Fix lot assignments: move 4 tenants from A6-A9 to H3-H6
 * and create the H3-H6 lots. One-time production fix.
 */
const { db, initializeDatabase, saveDb } = require('../server/database');

initializeDatabase().then(() => {
  console.log('[fix-lots] Database initialized');

  // 1. Create H3-H6 lots if they don't exist
  const newLots = [
    ['H3', 'H', 3, 'occupied'],
    ['H4', 'H', 4, 'occupied'],
    ['H5', 'H', 5, 'occupied'],
    ['H6', 'H', 6, 'occupied'],
  ];
  for (const [id, row, num, status] of newLots) {
    const exists = db.prepare('SELECT id FROM lots WHERE id = ?').get(id);
    if (!exists) {
      db.prepare('INSERT INTO lots (id, row_letter, lot_number, status) VALUES (?, ?, ?, ?)').run(id, row, num, status);
      console.log('Created lot ' + id);
    } else {
      db.prepare('UPDATE lots SET status = ? WHERE id = ?').run(status, id);
      console.log('Lot ' + id + ' already exists, set to occupied');
    }
  }

  // 2. Move tenants and all related records
  const moves = [
    { from: 'A6', to: 'H3', name: 'Justin Martin' },
    { from: 'A7', to: 'H4', name: 'Aislinn Nygaard' },
    { from: 'A8', to: 'H5', name: 'Shawna Nygaard' },
    { from: 'A9', to: 'H6', name: 'Jolie Hebert' },
  ];

  for (const m of moves) {
    // Update tenant
    const t = db.prepare('UPDATE tenants SET lot_id = ? WHERE lot_id = ?').run(m.to, m.from);
    console.log('Moved ' + m.name + ': ' + m.from + ' -> ' + m.to + ' (' + t.changes + ' tenant rows)');

    // Update invoices
    const inv = db.prepare('UPDATE invoices SET lot_id = ? WHERE lot_id = ?').run(m.to, m.from);
    console.log('  Invoices updated: ' + inv.changes);

    // Update meter readings
    const mr = db.prepare('UPDATE meter_readings SET lot_id = ? WHERE lot_id = ?').run(m.to, m.from);
    console.log('  Meter readings updated: ' + mr.changes);

    // Update checkins (if any)
    try {
      const ci = db.prepare('UPDATE checkins SET lot_id = ? WHERE lot_id = ?').run(m.to, m.from);
      if (ci.changes) console.log('  Checkins updated: ' + ci.changes);
    } catch (e) { /* table may not have data */ }
  }

  // 3. Delete or vacate old A6-A9 lots
  ['A6', 'A7', 'A8', 'A9'].forEach(id => {
    // Check no tenants remain on this lot
    const remaining = db.prepare('SELECT COUNT(*) as c FROM tenants WHERE lot_id = ?').get(id);
    if (remaining.c === 0) {
      db.prepare('DELETE FROM lots WHERE id = ?').run(id);
      console.log('Deleted empty lot ' + id);
    } else {
      console.log('WARNING: lot ' + id + ' still has ' + remaining.c + ' tenants, not deleting');
    }
  });

  // 4. Verify
  console.log('\n=== VERIFICATION ===');
  const allLots = db.prepare('SELECT id, status FROM lots ORDER BY id').all();
  console.log('Total lots: ' + allLots.length);
  console.log('All lot IDs: ' + allLots.map(l => l.id).join(', '));

  const moved = db.prepare("SELECT lot_id, first_name, last_name FROM tenants WHERE lot_id IN ('H3','H4','H5','H6') ORDER BY lot_id").all();
  moved.forEach(t => console.log('  ' + t.lot_id + ': ' + t.first_name + ' ' + t.last_name));

  const orphans = db.prepare("SELECT lot_id, first_name, last_name FROM tenants WHERE lot_id IN ('A6','A7','A8','A9')").all();
  if (orphans.length) {
    console.log('WARNING — tenants still on old lots:');
    orphans.forEach(t => console.log('  ' + t.lot_id + ': ' + t.first_name + ' ' + t.last_name));
  } else {
    console.log('No tenants remain on A6-A9');
  }

  saveDb();
  console.log('\n[fix-lots] DONE — database saved');
  process.exit(0);
}).catch(err => {
  console.error('[fix-lots] FATAL:', err);
  process.exit(1);
});
