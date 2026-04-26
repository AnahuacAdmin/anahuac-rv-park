const { db, initializeDatabase, saveDb } = require('../server/database');

initializeDatabase().then(() => {
  // List all tables and their row counts first
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  tables.forEach(t => {
    const count = db.prepare('SELECT COUNT(*) as c FROM ' + t.name).get();
    console.log(t.name + ': ' + count.c + ' rows');
  });

  console.log('\n=== CLEARING OLD DATA ===');

  // Clear these tables completely:
  const clearTables = [
    'activity_log', 'activities', 'recent_activity',
    'payments', 'check_ins', 'checkins', 'check_in_out',
    'reservations', 'messages', 'notifications',
    'community_posts', 'community_comments', 'community_replies',
    'maintenance_requests', 'work_orders',
    'auto_message_log', 'review_requests',
    'eviction_flags', 'evictions',
    'electric_alerts', 'lot_inspections',
    'lost_found', 'lost_found_pets', 'bird_sightings',
    'hunting_fishing_posts', 'announcements',
    'health_alerts', 'weather_alerts_sent',
    'tenant_documents', 'expenses',
    'waitlist', 'reservation_groups', 'reservation_group_lots'
  ];

  clearTables.forEach(t => {
    try {
      db.prepare('DELETE FROM ' + t).run();
      console.log('Cleared: ' + t);
    } catch(e) {
      // Table might not exist, that's fine
    }
  });

  // Now fix invoices — make sure all are paid with matching payments
  console.log('\n=== FIXING PAYMENTS ===');
  const invoices = db.prepare('SELECT * FROM invoices').all();
  console.log('Invoices found: ' + invoices.length);

  // Insert a payment for each paid invoice
  invoices.forEach(inv => {
    try {
      db.prepare('INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?)').run(
        inv.tenant_id, inv.id, '2026-04-01', inv.total_amount, 'cash', 'April 2026 payment'
      );
    } catch(e) {
      console.log('Payment insert error for ' + inv.lot_id + ': ' + e.message);
    }
  });

  // Reset all tenant eviction flags and credit balances
  console.log('\n=== RESETTING TENANT FLAGS ===');
  db.prepare('UPDATE tenants SET eviction_warning = 0, eviction_notified = 0, eviction_paused = 0, credit_balance = 0').run();
  console.log('Reset eviction flags and credit balances');

  // Verify
  console.log('\n=== VERIFICATION ===');
  const payCount = db.prepare('SELECT COUNT(*) as c, SUM(amount) as total FROM payments').get();
  console.log('Payments: ' + payCount.c + ' totaling $' + (payCount.total || 0).toFixed(2));

  const outstanding = db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status != 'paid'").get();
  console.log('Unpaid invoices: ' + outstanding.c);

  const evictCount = db.prepare('SELECT COUNT(*) as c FROM tenants WHERE eviction_warning = 1 OR eviction_notified = 1').get();
  console.log('Eviction flags: ' + evictCount.c);

  // Re-check table counts
  console.log('\n=== FINAL TABLE COUNTS ===');
  tables.forEach(t => {
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM ' + t.name).get();
      if (count.c > 0) console.log('  ' + t.name + ': ' + count.c + ' rows');
    } catch(e) {}
  });

  saveDb();
  console.log('\nDatabase saved. DONE — redeploy to refresh.');
  process.exit(0);
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
