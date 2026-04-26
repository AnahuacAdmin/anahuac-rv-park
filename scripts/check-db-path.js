const path = require('path');
const fs = require('fs');

// Show environment
console.log('RAILWAY_VOLUME_MOUNT_PATH:', process.env.RAILWAY_VOLUME_MOUNT_PATH);
console.log('DB_PATH env:', process.env.DB_PATH);

// Replicate the same path logic from database.js
const DB_PATH = process.env.DB_PATH
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'rvpark.db')
    : path.join(__dirname, '..', 'data', 'rvpark.db'));

console.log('Resolved DB_PATH:', DB_PATH);
console.log('File exists:', fs.existsSync(DB_PATH));
if (fs.existsSync(DB_PATH)) {
  const stat = fs.statSync(DB_PATH);
  console.log('File size:', stat.size, 'bytes');
  console.log('Last modified:', stat.mtime.toISOString());
}

// Check if /data/rvpark.db exists separately
const altPaths = ['/data/rvpark.db', '/app/data/rvpark.db', './data/rvpark.db'];
altPaths.forEach(p => {
  if (fs.existsSync(p)) {
    const s = fs.statSync(p);
    console.log('FOUND ' + p + ': ' + s.size + ' bytes, modified ' + s.mtime.toISOString());
  } else {
    console.log('NOT FOUND: ' + p);
  }
});

// Check if they're the same file (inode)
try {
  const s1 = fs.statSync('/data/rvpark.db');
  const s2 = fs.statSync('/app/data/rvpark.db');
  console.log('/data inode:', s1.ino, '/app/data inode:', s2.ino);
  console.log('Same file:', s1.ino === s2.ino);
} catch(e) {
  console.log('Inode compare error:', e.message);
}

// Now load and check the actual data
const { db, initializeDatabase } = require('../server/database');
initializeDatabase().then(() => {
  console.log('\n=== DATA IN LOADED DB ===');

  const tenants = db.prepare('SELECT COUNT(*) as c FROM tenants').get();
  console.log('Tenants:', tenants.c);

  const invoices = db.prepare('SELECT status, COUNT(*) as c FROM invoices GROUP BY status').all();
  console.log('Invoices:', JSON.stringify(invoices));

  const payments = db.prepare('SELECT COUNT(*) as c, SUM(amount) as t FROM payments').get();
  console.log('Payments:', payments.c, 'total: $' + (payments.t || 0).toFixed(2));

  const evict = db.prepare('SELECT COUNT(*) as c FROM tenants WHERE eviction_warning = 1 OR eviction_notified = 1').get();
  console.log('Eviction flags:', evict.c);

  // Check for any table with "activity" or "eviction" in the name
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const suspicious = tables.filter(t => /activity|evict|alert|log/i.test(t.name));
  console.log('\nSuspicious tables:', suspicious.map(t => t.name).join(', ') || '(none)');
  suspicious.forEach(t => {
    const count = db.prepare('SELECT COUNT(*) as c FROM ' + t.name).get();
    if (count.c > 0) console.log('  ' + t.name + ': ' + count.c + ' rows');
  });

  process.exit(0);
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
