const { db, initializeDatabase } = require('../server/database');

initializeDatabase().then(() => {
  // All tables and row counts
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('=== ALL TABLES ===');
  tables.forEach(t => {
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM ' + t.name).get();
      console.log('  ' + t.name + ': ' + count.c + ' rows');
    } catch(e) { console.log('  ' + t.name + ': ERROR - ' + e.message); }
  });

  // Invoice statuses
  console.log('\n=== INVOICE STATUSES ===');
  const invoices = db.prepare('SELECT status, COUNT(*) as c FROM invoices GROUP BY status').all();
  invoices.forEach(i => console.log('  ' + i.status + ': ' + i.c));

  // Unpaid invoices
  console.log('\n=== UNPAID INVOICES ===');
  const unpaid = db.prepare("SELECT lot_id, total_amount, balance_due, status FROM invoices WHERE status != 'paid' LIMIT 20").all();
  if (unpaid.length === 0) console.log('  (none)');
  unpaid.forEach(i => console.log('  ' + i.lot_id + ': $' + i.total_amount + ' balance=$' + i.balance_due + ' status=' + i.status));

  // Eviction flags
  console.log('\n=== EVICTION FLAGS ===');
  const evictions = db.prepare('SELECT lot_id, first_name, last_name, eviction_warning, eviction_notified, eviction_paused FROM tenants WHERE eviction_warning = 1 OR eviction_notified = 1').all();
  console.log('  Count: ' + evictions.length);
  evictions.forEach(e => console.log('  ' + e.lot_id + ': ' + e.first_name + ' ' + e.last_name + ' warn=' + e.eviction_warning + ' notified=' + e.eviction_notified + ' paused=' + e.eviction_paused));

  // All tenants eviction state
  console.log('\n=== ALL TENANTS EVICTION STATE ===');
  const allTenants = db.prepare('SELECT lot_id, first_name, last_name, eviction_warning, eviction_notified, credit_balance, is_active FROM tenants ORDER BY lot_id').all();
  allTenants.forEach(t => console.log('  ' + t.lot_id + ': ' + t.first_name + ' ' + t.last_name + ' evict_warn=' + t.eviction_warning + ' evict_notif=' + t.eviction_notified + ' credit=' + t.credit_balance + ' active=' + t.is_active));

  // Electric alerts
  console.log('\n=== ELECTRIC ALERTS ===');
  try {
    const alerts = db.prepare('SELECT * FROM electric_alerts LIMIT 10').all();
    console.log('  Count: ' + alerts.length);
    alerts.forEach(a => console.log('  ' + JSON.stringify(a)));
  } catch(e) { console.log('  ' + e.message); }

  // Lot inspections
  console.log('\n=== LOT INSPECTIONS ===');
  try {
    const insp = db.prepare('SELECT * FROM lot_inspections LIMIT 10').all();
    console.log('  Count: ' + insp.length);
    insp.forEach(i => console.log('  ' + JSON.stringify(i)));
  } catch(e) { console.log('  ' + e.message); }

  // Health alerts
  console.log('\n=== HEALTH ALERTS ===');
  try {
    const ha = db.prepare('SELECT COUNT(*) as c FROM health_alerts').get();
    console.log('  Count: ' + ha.c);
  } catch(e) {}

  // Weather alerts
  console.log('\n=== WEATHER ALERTS ===');
  try {
    const wa = db.prepare('SELECT COUNT(*) as c FROM weather_alerts_sent').get();
    console.log('  Count: ' + wa.c);
  } catch(e) {}

  // Waitlist
  console.log('\n=== WAITLIST ===');
  try {
    const wl = db.prepare('SELECT COUNT(*) as c FROM waitlist').get();
    console.log('  Count: ' + wl.c);
  } catch(e) {}

  // Reservations
  console.log('\n=== RESERVATIONS ===');
  try {
    const res = db.prepare('SELECT COUNT(*) as c FROM reservations').get();
    console.log('  Count: ' + res.c);
  } catch(e) {}

  // Tenant documents
  console.log('\n=== TENANT DOCUMENTS ===');
  try {
    const docs = db.prepare('SELECT COUNT(*) as c FROM tenant_documents').get();
    console.log('  Count: ' + docs.c);
  } catch(e) {}

  // Settings dump
  console.log('\n=== ALL SETTINGS ===');
  const settings = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
  settings.forEach(s => console.log('  ' + s.key + ' = ' + s.value));

  process.exit(0);
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
