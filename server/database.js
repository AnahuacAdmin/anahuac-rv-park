const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'rvpark.db')
    : path.join(__dirname, '..', 'data', 'rvpark.db'));
const dataDir = path.dirname(DB_PATH);
console.log(`[database] using DB_PATH = ${DB_PATH}`);

let db = null;

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save every 5 seconds if changes were made
let dirty = false;
function markDirty() { dirty = true; }
setInterval(() => { if (dirty && db) { saveDb(); dirty = false; } }, 5000);

// Wrapper to match better-sqlite3-like API
class DbWrapper {
  prepare(sql) {
    return {
      run: (...params) => {
        db.run(sql, params);
        markDirty();
        const lastId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0];
        const changes = db.getRowsModified();
        return { lastInsertRowid: lastId, changes };
      },
      get: (...params) => {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          return row;
        }
        stmt.free();
        return undefined;
      },
      all: (...params) => {
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          results.push(row);
        }
        stmt.free();
        return results;
      }
    };
  }

  exec(sql) {
    db.run(sql);
    markDirty();
  }
}

const dbWrapper = new DbWrapper();

async function initializeDatabase() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs({
    locateFile: file => require.resolve(`sql.js/dist/${file}`),
  });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys = ON");

  // Migrations: add new invoice fee columns if missing
  const addCol = (sql) => { try { db.run(sql); } catch (e) { /* already exists */ } };
  addCol("ALTER TABLE invoices ADD COLUMN mailbox_fee REAL DEFAULT 0");
  addCol("ALTER TABLE invoices ADD COLUMN misc_fee REAL DEFAULT 0");
  addCol("ALTER TABLE invoices ADD COLUMN misc_description TEXT");
  addCol("ALTER TABLE invoices ADD COLUMN refund_amount REAL DEFAULT 0");
  addCol("ALTER TABLE invoices ADD COLUMN refund_description TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN recurring_late_fee REAL DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN recurring_mailbox_fee REAL DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN recurring_misc_fee REAL DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN recurring_misc_description TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN recurring_credit REAL DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN recurring_credit_description TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN eviction_warning INTEGER DEFAULT 0");
  addCol("ALTER TABLE invoices ADD COLUMN late_fee_auto_applied INTEGER DEFAULT 0");
  addCol("ALTER TABLE invoices ADD COLUMN deleted INTEGER DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN mid_month_move_notes TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN last_move_date DATE");
  addCol("ALTER TABLE tenants ADD COLUMN last_move_old_lot_id TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN last_move_old_rent REAL");
  addCol("ALTER TABLE meter_readings ADD COLUMN photo TEXT");
  addCol("ALTER TABLE meter_readings ADD COLUMN notes TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN credit_balance REAL DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN sms_opt_in INTEGER DEFAULT 1");
  addCol("ALTER TABLE tenants ADD COLUMN email_opt_in INTEGER DEFAULT 1");
  addCol("ALTER TABLE tenants ADD COLUMN invoice_delivery TEXT DEFAULT 'both'");
  addCol("ALTER TABLE invoices ADD COLUMN credit_applied REAL DEFAULT 0");

  db.run(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      lot_id TEXT REFERENCES lots(id),
      arrival_date DATE NOT NULL,
      departure_date DATE NOT NULL,
      nights INTEGER DEFAULT 1,
      rate_per_night REAL DEFAULT 50,
      total_amount REAL DEFAULT 0,
      deposit_paid REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      confirmation_number TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // One-shot cleanup: remove lot A6 if it still exists from the old seed.
  try {
    const a6 = db.exec("SELECT id FROM lots WHERE id = 'A6'");
    if (a6.length && a6[0].values.length) {
      db.run("DELETE FROM lots WHERE id = 'A6'");
      console.log('Migration: deleted lot A6');
    }
  } catch (e) { /* table may not exist yet on a brand-new DB */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lots (
      id TEXT PRIMARY KEY,
      row_letter TEXT NOT NULL,
      lot_number INTEGER NOT NULL,
      width INTEGER DEFAULT 30,
      length INTEGER DEFAULT 60,
      status TEXT DEFAULT 'vacant',
      notes TEXT,
      size_restriction TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id TEXT REFERENCES lots(id),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      rv_make TEXT,
      rv_model TEXT,
      rv_year TEXT,
      rv_length TEXT,
      license_plate TEXT,
      monthly_rent REAL DEFAULT 295,
      rent_type TEXT DEFAULT 'standard',
      move_in_date DATE,
      move_out_date DATE,
      is_active INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS meter_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id TEXT REFERENCES lots(id),
      tenant_id INTEGER REFERENCES tenants(id),
      reading_date DATE NOT NULL,
      previous_reading REAL,
      current_reading REAL,
      kwh_used REAL,
      rate_per_kwh REAL DEFAULT 0.15,
      electric_charge REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      lot_id TEXT,
      invoice_number TEXT UNIQUE,
      invoice_date DATE NOT NULL,
      due_date DATE NOT NULL,
      billing_period_start DATE,
      billing_period_end DATE,
      rent_amount REAL DEFAULT 0,
      electric_amount REAL DEFAULT 0,
      other_charges REAL DEFAULT 0,
      other_description TEXT,
      subtotal REAL DEFAULT 0,
      late_fee REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      amount_paid REAL DEFAULT 0,
      balance_due REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      invoice_id INTEGER REFERENCES invoices(id),
      payment_date DATE NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      reference_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      lot_id TEXT REFERENCES lots(id),
      check_in_date DATE,
      check_out_date DATE,
      status TEXT DEFAULT 'checked_in',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      subject TEXT,
      body TEXT NOT NULL,
      message_type TEXT DEFAULT 'notice',
      is_broadcast INTEGER DEFAULT 0,
      sent_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      rv_length TEXT,
      preferred_lot TEXT,
      date_added DATE DEFAULT (date('now')),
      status TEXT DEFAULT 'waiting',
      notes TEXT,
      position INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed admin user
  const existingUser = dbWrapper.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existingUser) {
    const hash = bcrypt.hashSync('anahuac2026', 10);
    dbWrapper.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
  }

  // Seed settings
  const existingSettings = dbWrapper.prepare('SELECT key FROM settings WHERE key = ?').get('electric_rate');
  if (!existingSettings) {
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('electric_rate', '0.15');
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('park_name', 'Anahuac RV Park, LLC');
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('park_address', '1003 Davis Ave, Anahuac, TX 77514');
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('park_phone', '409-267-6603');
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('late_fee_amount', '25');
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('late_fee_day', '5');
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('recovery_pin', 'anahuac911');
  }

  // Ensure recovery_pin exists even on already-seeded databases
  const pinRow = dbWrapper.prepare('SELECT key FROM settings WHERE key = ?').get('recovery_pin');
  if (!pinRow) {
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('recovery_pin', 'anahuac911');
  }

  // Seed lots
  const existingLots = dbWrapper.prepare('SELECT COUNT(*) as count FROM lots').get();
  if (existingLots.count === 0) {
    const lots = [
      ['A1','A',1,'owner_reserved'], ['A2','A',2,'occupied'], ['A3','A',3,'occupied'],
      ['A4','A',4,'occupied'], ['A5','A',5,'occupied'],
      ['B1','B',1,'owner_reserved'], ['B2','B',2,'occupied'], ['B3','B',3,'vacant'],
      ['B4','B',4,'occupied'],
      ['C1','C',1,'vacant'], ['C2','C',2,'vacant'], ['C3','C',3,'occupied'],
      ['D1','D',1,'vacant'], ['D2','D',2,'vacant'], ['D3','D',3,'occupied'],
      ['E1','E',1,'occupied'], ['E2','E',2,'occupied'], ['E3','E',3,'occupied'], ['E4','E',4,'occupied'],
      ['F1','F',1,'occupied'], ['F2','F',2,'occupied'], ['F3','F',3,'occupied'],
      ['F4','F',4,'vacant'], ['F5','F',5,'occupied'],
      ['G1','G',1,'occupied'], ['G2','G',2,'occupied'], ['G3','G',3,'occupied'],
      ['G4','G',4,'occupied'], ['G5','G',5,'occupied'],
      ['H1','H',1,'vacant'], ['H2','H',2,'occupied'], ['H3','H',3,'occupied'],
      ['H4','H',4,'occupied'], ['H5','H',5,'occupied'], ['H6','H',6,'occupied']
    ];

    for (const [id, row, num, status] of lots) {
      let restriction = null;
      let notes = null;
      if (id === 'F4') restriction = '25ft & under only';
      if (id === 'A1') notes = 'OUR SPACE (owner/reserved)';
      if (id === 'B1') notes = 'Ours-Henry (owner/reserved)';
      dbWrapper.prepare('INSERT INTO lots (id, row_letter, lot_number, status, size_restriction, notes) VALUES (?, ?, ?, ?, ?, ?)').run(id, row, num, status, restriction, notes);
    }
  }

  // Seed tenants
  const existingTenants = dbWrapper.prepare('SELECT COUNT(*) as count FROM tenants').get();
  if (existingTenants.count === 0) {
    const tenants = [
      ['A2','Brandy','McDaniel',295,'standard','2026-01-01',null],
      ['A3','Curtis & Nicole','McKinzy',295,'standard','2026-01-01',548],
      ['A4','Fredrick','Tham',295,'standard','2026-01-01',206],
      ['A5','Ruth','Morrison',295,'standard','2026-01-01',133],
      ['B2','David','Carroll',39.33,'prorated','2026-03-15',143],
      ['B4','Michael & Fanci','Hebert',295,'standard','2026-01-01',629],
      ['C3','Amy','Gilmore',295,'standard','2026-01-01',519],
      ['D3','Kenneth','Preston',295,'standard','2026-01-01',582],
      ['E1','Lucas','Carson',295,'standard','2026-01-01',618],
      ['E2','Jamie','Linares',295,'standard','2026-01-01',666],
      ['E3','Eric','Tutt',295,'standard','2026-01-01',0],
      ['E4','Jan & Rodney','Kimmons',200,'standard','2026-01-01',414],
      ['F1','Richard','DeSMit',295,'standard','2026-01-01',418],
      ['F2','Paige','Curbow',0,'electric_only','2026-01-01',205],
      ['F3','Darla','Willcox',295,'standard','2026-01-01',497],
      ['F5','Dennis','Collins',295,'standard','2026-01-01',445],
      ['G1','John','Phelps',295,'standard','2026-01-01',351],
      ['G2','Rodney','Woods',295,'standard','2026-01-01',498],
      ['G3','David','Williams',295,'standard','2026-01-01',491],
      ['G4','Keisha','LaVergne',295,'standard','2026-01-01',407],
      ['G5','Jim','Morse',295,'standard','2026-01-01',514],
      ['H2','Ezequiel','Arellano',295,'standard','2026-01-01',367],
      ['H3','Justin','Martin',295,'standard','2026-01-01',653],
      ['H4','Aislinn','Nygaard',350,'premium','2026-01-01',1233],
      ['H5','Shawna','Nygaard',350,'premium','2026-01-01',1141],
      ['H6','Jolie','Hebert',375,'premium','2026-01-01',476]
    ];

    for (const [lot, first, last, rent, type, moveIn, kwh] of tenants) {
      const result = dbWrapper.prepare(
        'INSERT INTO tenants (lot_id, first_name, last_name, monthly_rent, rent_type, move_in_date, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
      ).run(lot, first, last, rent, type, moveIn);

      if (kwh !== null) {
        dbWrapper.prepare(
          'INSERT INTO meter_readings (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge) VALUES (?, ?, ?, ?, ?, ?, 0.15, ?)'
        ).run(lot, result.lastInsertRowid, '2026-04-01', 0, kwh, kwh, kwh * 0.15);
      }
    }
  }

  saveDb();
  console.log('Database initialized successfully');
}

// Graceful save on exit
process.on('exit', () => { if (db) saveDb(); });
process.on('SIGINT', () => { if (db) saveDb(); process.exit(); });

// Replace the in-memory database from a raw .sqlite file buffer (used by the
// admin restore endpoint). Writes the buffer to DB_PATH and reloads sql.js so
// the running process picks up the new data without a restart. The DbWrapper
// methods always read the module-level `db`, so reassigning it here is enough.
async function reloadDatabase(buffer) {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: file => require.resolve(`sql.js/dist/${file}`),
  });
  // Validate it actually loads as a sqlite database before overwriting anything.
  const newDb = new SQL.Database(new Uint8Array(buffer));
  newDb.run("PRAGMA foreign_keys = ON");
  // Persist the new file to disk, then swap the in-memory handle.
  fs.writeFileSync(DB_PATH, buffer);
  if (db) {
    try { db.close(); } catch {}
  }
  db = newDb;
  console.log('[database] restored from uploaded backup');
}

module.exports = { db: dbWrapper, initializeDatabase, reloadDatabase, saveDb, DB_PATH };
