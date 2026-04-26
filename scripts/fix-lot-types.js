/*
 * Fix lot types: reset H3-H6 to standard, migrate pull-through lot_type to amenity
 */
const { db, initializeDatabase, saveDb } = require('../server/database');

initializeDatabase().then(() => {
  console.log('[fix-lot-types] Database initialized');

  // 1. Fix H3-H6 to standard
  ['H3', 'H4', 'H5', 'H6'].forEach(id => {
    db.prepare('UPDATE lots SET lot_type = ? WHERE id = ?').run('standard', id);
    console.log(id + ' set to standard');
  });

  // 2. Migrate any lots with lot_type='pull-through' to standard + Pull-Through amenity
  const ptLots = db.prepare("SELECT id, lot_type, amenities FROM lots WHERE lot_type = 'pull-through'").all();
  for (const lot of ptLots) {
    const amenities = lot.amenities ? lot.amenities + ',Pull-Through' : 'Pull-Through';
    db.prepare('UPDATE lots SET lot_type = ?, amenities = ? WHERE id = ?').run('standard', amenities, lot.id);
    console.log('Migrated ' + lot.id + ' from pull-through type to standard + Pull-Through amenity');
  }

  // 3. Verify
  console.log('\n=== ALL LOT TYPES ===');
  const all = db.prepare('SELECT id, lot_type, amenities FROM lots ORDER BY id').all();
  all.forEach(l => console.log('  ' + l.id + ': type=' + l.lot_type + (l.amenities ? ' amenities=' + l.amenities : '')));

  saveDb();
  console.log('\n[fix-lot-types] DONE');
  process.exit(0);
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
