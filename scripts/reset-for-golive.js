// GO-LIVE RESET SCRIPT
// Wipes all test data while keeping tenants, lots, and user accounts.
// Run: node scripts/reset-for-golive.js
// On Railway: npx railway run node scripts/reset-for-golive.js

const readline = require('readline');
const { initializeDatabase, db } = require('../server/database');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function main() {
  await initializeDatabase();

  console.log('\n========================================');
  console.log('  ANAHUAC RV PARK — GO-LIVE RESET');
  console.log('========================================\n');

  // Preview what will be deleted
  const invoiceCount = db.prepare('SELECT COUNT(*) as c FROM invoices').get().c;
  const paymentCount = db.prepare('SELECT COUNT(*) as c FROM payments').get().c;
  const meterCount = db.prepare('SELECT COUNT(*) as c FROM meter_readings').get().c;
  const messageCount = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;
  let reservationCount = 0;
  try { reservationCount = db.prepare('SELECT COUNT(*) as c FROM reservations').get().c; } catch {}
  let groupCount = 0;
  try { groupCount = db.prepare('SELECT COUNT(*) as c FROM reservation_groups').get().c; } catch {}
  const checkinCount = db.prepare('SELECT COUNT(*) as c FROM checkins').get().c;
  const tenantCount = db.prepare('SELECT COUNT(*) as c FROM tenants').get().c;
  const lotCount = db.prepare('SELECT COUNT(*) as c FROM lots').get().c;
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

  console.log('WILL DELETE:');
  console.log(`  📋 ${invoiceCount} invoices`);
  console.log(`  💰 ${paymentCount} payments`);
  console.log(`  ⚡ ${meterCount} meter readings`);
  console.log(`  📨 ${messageCount} messages`);
  console.log(`  📅 ${reservationCount} reservations`);
  console.log(`  👨‍👩‍👧‍👦 ${groupCount} reservation groups`);
  console.log(`  🏕️ ${checkinCount} check-in records`);
  console.log('');
  console.log('WILL KEEP:');
  console.log(`  👤 ${tenantCount} tenants (reset balances to $0)`);
  console.log(`  🏠 ${lotCount} lots (keep as-is)`);
  console.log(`  🔑 ${userCount} user accounts`);
  console.log('');
  console.log('WILL RESET:');
  console.log('  - All tenant credit_balance → $0');
  console.log('  - All tenant eviction_warning → 0');
  console.log('  - All tenant eviction_notified → 0');
  console.log('  - All tenant eviction_paused → 0');
  console.log('  - All tenant portal_pin → NULL (tenants must re-set)');
  console.log('  - Invoice numbering restarts at INV-0001');
  console.log('');
  console.log('⚠️  THIS CANNOT BE UNDONE! Download a backup first.\n');

  rl.question('Type CONFIRM to proceed: ', (answer) => {
    if (answer.trim() !== 'CONFIRM') {
      console.log('Aborted. No changes made.');
      process.exit(0);
    }

    console.log('\nWiping test data...\n');

    // Delete test data
    const r1 = db.prepare('DELETE FROM payments').run();
    console.log(`  ✅ Deleted ${r1.changes} payments`);

    const r2 = db.prepare('DELETE FROM invoices').run();
    console.log(`  ✅ Deleted ${r2.changes} invoices`);

    const r3 = db.prepare('DELETE FROM meter_readings').run();
    console.log(`  ✅ Deleted ${r3.changes} meter readings`);

    const r4 = db.prepare('DELETE FROM messages').run();
    console.log(`  ✅ Deleted ${r4.changes} messages`);

    try { const r5 = db.prepare('DELETE FROM reservation_group_lots').run(); console.log(`  ✅ Deleted ${r5.changes} group lot links`); } catch {}
    try { const r6 = db.prepare('DELETE FROM reservation_groups').run(); console.log(`  ✅ Deleted ${r6.changes} reservation groups`); } catch {}
    try { const r7 = db.prepare('DELETE FROM reservations').run(); console.log(`  ✅ Deleted ${r7.changes} reservations`); } catch {}

    const r8 = db.prepare('DELETE FROM checkins').run();
    console.log(`  ✅ Deleted ${r8.changes} check-in records`);

    // Reset tenant balances and flags
    db.prepare('UPDATE tenants SET credit_balance = 0, eviction_warning = 0, eviction_notified = 0, eviction_paused = 0, eviction_pause_note = NULL, eviction_pause_date = NULL, eviction_pause_by = NULL, portal_pin = NULL').run();
    console.log(`  ✅ Reset all tenant balances and flags`);

    // Clear new Phase 1 tables
    try { db.prepare('DELETE FROM maintenance_requests').run(); console.log('  ✅ Cleared maintenance requests'); } catch {}
    try { db.prepare('DELETE FROM expenses').run(); console.log('  ✅ Cleared expenses'); } catch {}
    try { db.prepare('DELETE FROM announcements').run(); console.log('  ✅ Cleared announcements'); } catch {}
    try { db.prepare('DELETE FROM tenant_documents').run(); console.log('  ✅ Cleared tenant documents'); } catch {}
    try { db.prepare('DELETE FROM health_alerts').run(); console.log('  ✅ Cleared health alerts'); } catch {}

    // Clear settings keys used for email rate-limiting
    db.prepare("DELETE FROM settings WHERE key LIKE 'last_email_%'").run();
    console.log(`  ✅ Cleared email rate-limit keys`);

    console.log('\n========================================');
    console.log('  GO-LIVE RESET COMPLETE! 🎉');
    console.log('  All test data has been wiped.');
    console.log('  New invoices will start at INV-0001.');
    console.log('  New reservations will start at RES-0001.');
    console.log('  Tenants will need to re-set portal PINs.');
    console.log('========================================\n');

    // Let the auto-save flush
    setTimeout(() => process.exit(0), 1000);
  });
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
