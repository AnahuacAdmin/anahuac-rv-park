/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
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
  addCol("ALTER TABLE checkins ADD COLUMN move_out_statement TEXT");
  db.run(`CREATE TABLE IF NOT EXISTS reservation_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name TEXT NOT NULL,
    primary_contact_name TEXT,
    primary_contact_phone TEXT,
    primary_contact_email TEXT,
    arrival_date DATE NOT NULL,
    departure_date DATE NOT NULL,
    nights INTEGER DEFAULT 1,
    billing_type TEXT DEFAULT 'separate',
    notes TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS reservation_group_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES reservation_groups(id),
    lot_id TEXT REFERENCES lots(id),
    occupant_name TEXT,
    occupant_notes TEXT,
    reservation_id INTEGER REFERENCES reservations(id)
  )`);

  addCol("ALTER TABLE tenants ADD COLUMN portal_pin TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN eviction_paused INTEGER DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN eviction_pause_note TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN eviction_pause_date TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN eviction_pause_by TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN eviction_notified INTEGER DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN sms_opt_in INTEGER DEFAULT 1");
  addCol("ALTER TABLE tenants ADD COLUMN email_opt_in INTEGER DEFAULT 1");
  addCol("ALTER TABLE tenants ADD COLUMN invoice_delivery TEXT DEFAULT 'both'");
  addCol("ALTER TABLE invoices ADD COLUMN credit_applied REAL DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN id_number TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN date_of_birth DATE");
  addCol("ALTER TABLE tenants ADD COLUMN deposit_amount REAL DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN flat_rate INTEGER DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN flat_rate_amount REAL DEFAULT 0");

  // Portal restaurants
  db.run(`CREATE TABLE IF NOT EXISTS portal_restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    emoji TEXT DEFAULT '🍽️',
    url TEXT,
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
  )`);
  var rCount = db.prepare('SELECT COUNT(*) as c FROM portal_restaurants').get().c;
  if (rCount === 0) {
    var ins = db.prepare('INSERT INTO portal_restaurants (name, emoji, url, display_order, is_active) VALUES (?,?,?,?,1)');
    ins.run('Nautilus Grill', '🦐', 'https://www.google.com/maps/search/Nautilus+Grill+Anahuac+TX', 1);
    ins.run('The Roost', '🍗', 'https://www.google.com/maps/search/The+Roost+Anahuac+TX', 2);
    ins.run('Stingaree', '🐟', 'https://www.google.com/maps/search/Stingaree+Restaurant+Crystal+Beach+TX', 3);
    ins.run('Find More Food', '🔍', 'https://www.google.com/maps/search/restaurants+near+Anahuac+TX+77514', 4);
  }

  addCol("ALTER TABLE tenants ADD COLUMN deposit_waived INTEGER DEFAULT 0");

  // Portal local links
  db.run(`CREATE TABLE IF NOT EXISTS portal_local_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT DEFAULT 'attraction',
    name TEXT NOT NULL,
    emoji TEXT DEFAULT '🔗',
    url TEXT,
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
  )`);
  var linkCount = 0;
  try { linkCount = db.prepare('SELECT COUNT(*) as c FROM portal_local_links').get().c; } catch {}
  if (linkCount === 0) {
    var lins = db.prepare('INSERT INTO portal_local_links (category, name, emoji, url, display_order, is_active) VALUES (?,?,?,?,?,1)');
    lins.run('attraction', 'City of Anahuac', '🏛️', 'https://anahuac.us/', 1);
    lins.run('attraction', 'Tourism & Visiting', '🌿', 'https://anahuac.us/living-visiting/tourism/', 2);
    lins.run('attraction', 'Wildlife Refuge', '🐊', 'https://www.fws.gov/refuge/anahuac', 3);
    lins.run('attraction', 'Gatorfest Info', '🎪', 'https://anahuac.us/living-visiting/tourism/', 4);
    lins.run('attraction', 'Fort Anahuac Park', '⚓', 'https://www.facebook.com/FortAnahuacPark', 5);
    lins.run('fishing', 'TX Fishing Report', '🎣', 'https://tpwd.texas.gov/fishboat/fish/recreational/fishreport.phtml', 1);
    lins.run('fishing', 'East Bay Report', '🐟', 'https://tpwd.texas.gov/fishboat/fish/action/reptform2.php?lake=TEXAS+CITY&archive=latest&yearcat=current&Submit=Go', 2);
    lins.run('fishing', 'Tide Report', '🌊', 'https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=8771341&units=standard&timezone=LST/LDT&clock=12hour&datum=MLLW&interval=hilo&action=dailychart', 3);
  }

  // Community board
  db.run(`CREATE TABLE IF NOT EXISTS community_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    lot_id TEXT,
    post_type TEXT DEFAULT 'community',
    title TEXT,
    message TEXT,
    photo_data TEXT,
    status TEXT DEFAULT 'pending',
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    approved_by TEXT,
    rejection_reason TEXT,
    is_pinned INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0
  )`);

  // Community replies
  db.run(`CREATE TABLE IF NOT EXISTS community_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    tenant_id INTEGER,
    author_name TEXT NOT NULL,
    author_lot TEXT,
    is_management INTEGER DEFAULT 0,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  addCol("ALTER TABLE community_posts ADD COLUMN reply_count INTEGER DEFAULT 0");

  // Hunting & Fishing Brag Board
  db.run(`CREATE TABLE IF NOT EXISTS hunting_fishing_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    post_type TEXT NOT NULL DEFAULT 'fishing',
    species TEXT,
    weight_lbs REAL DEFAULT 0,
    weight_oz REAL DEFAULT 0,
    length_inches REAL DEFAULT 0,
    location TEXT,
    method TEXT,
    bait_used TEXT,
    photo_data TEXT,
    description TEXT,
    likes_count INTEGER DEFAULT 0,
    is_featured INTEGER DEFAULT 0,
    is_biggest_of_month INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Bird Sightings
  db.run(`CREATE TABLE IF NOT EXISTS bird_sightings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    bird_name TEXT NOT NULL,
    location TEXT,
    spotted_date DATE,
    spotted_time TEXT,
    rarity TEXT DEFAULT 'Common',
    photo_data TEXT,
    notes TEXT,
    likes_count INTEGER DEFAULT 0,
    is_featured INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Lost & Found Pets
  db.run(`CREATE TABLE IF NOT EXISTS lost_found_pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    type TEXT NOT NULL DEFAULT 'lost',
    pet_type TEXT DEFAULT 'Dog',
    pet_name TEXT,
    breed TEXT,
    color_description TEXT,
    last_seen_location TEXT,
    date_occurred DATE,
    photo_data TEXT,
    contact_phone TEXT,
    details TEXT,
    status TEXT DEFAULT 'active',
    reunited_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Electric alerts
  db.run(`CREATE TABLE IF NOT EXISTS electric_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id TEXT, tenant_id INTEGER, alert_type TEXT,
    message TEXT, is_dismissed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, dismissed_at DATETIME
  )`);

  // Water meter tracking
  db.run(`CREATE TABLE IF NOT EXISTS water_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    rate_per_gallon REAL DEFAULT 0.00,
    service_fee_percent REAL DEFAULT 9,
    billing_enabled INTEGER DEFAULT 0,
    monthly_allowance_gallons REAL DEFAULT NULL,
    overage_only_mode INTEGER DEFAULT 1,
    evaluation_mode INTEGER DEFAULT 1
  )`);
  // Ensure the single settings row exists
  db.run(`INSERT OR IGNORE INTO water_settings (id) VALUES (1)`);

  db.run(`CREATE TABLE IF NOT EXISTS water_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id TEXT REFERENCES lots(id),
    reading_date DATE NOT NULL,
    previous_reading REAL DEFAULT 0,
    current_reading REAL DEFAULT 0,
    gallons_used REAL DEFAULT 0,
    estimated_charge REAL DEFAULT 0,
    notes TEXT,
    photo_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // SMS templates
  db.run(`CREATE TABLE IF NOT EXISTS sms_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, message TEXT NOT NULL,
    category TEXT DEFAULT 'general', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  var tmplCount = 0;
  try { tmplCount = db.prepare('SELECT COUNT(*) as c FROM sms_templates').get().c; } catch {}
  if (tmplCount === 0) {
    var ins = db.prepare('INSERT INTO sms_templates (name, message, category) VALUES (?,?,?)');
    ins.run('Maintenance Notice', 'Maintenance scheduled at your lot tomorrow between [time] and [time]. Thank you for your patience!', 'maintenance');
    ins.run('Water Shutoff', 'Water will be temporarily shut off [date] from [time] to [time] for maintenance. We apologize for the inconvenience.', 'utility');
    ins.run('Holiday Greeting', 'Happy [Holiday] from the Anahuac RV Park family! We are blessed to have you as our neighbor. 🐊', 'greeting');
    ins.run('Park Rule Reminder', 'Friendly reminder: [Park Rule]. Thank you for your cooperation! - Anahuac RV Park', 'reminder');
    ins.run('Weather Advisory', 'Weather advisory for Anahuac: [Description]. Please take precautions and secure your property.', 'weather');
    ins.run('Payment Received', 'Your payment of $[amount] has been received. Thank you! Balance: $[balance]. - Anahuac RV Park', 'payment');
    ins.run('Lease Renewal', 'Your lease renewal is coming up. Please contact us at 409-267-6603 to discuss. We appreciate your tenancy!', 'admin');
  }

  // Referral tracking
  addCol("ALTER TABLE tenants ADD COLUMN referred_by INTEGER");
  addCol("ALTER TABLE tenants ADD COLUMN referral_credit REAL DEFAULT 0");

  // Tenant loyalty and document expiry
  addCol("ALTER TABLE tenants ADD COLUMN loyalty_exclude INTEGER DEFAULT 0");
  addCol("ALTER TABLE tenants ADD COLUMN insurance_expiry DATE");
  addCol("ALTER TABLE tenants ADD COLUMN registration_expiry DATE");
  addCol("ALTER TABLE tenants ADD COLUMN grace_period_override INTEGER");

  // Tenant documents
  db.run(`CREATE TABLE IF NOT EXISTS tenant_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    lot_id TEXT,
    doc_type TEXT DEFAULT 'other',
    doc_name TEXT NOT NULL,
    file_data TEXT,
    file_type TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Maintenance requests
  db.run(`CREATE TABLE IF NOT EXISTS maintenance_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    lot_id TEXT,
    category TEXT DEFAULT 'Other',
    description TEXT,
    photo TEXT,
    status TEXT DEFAULT 'submitted',
    resolution_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  )`);

  // Expenses
  db.run(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_date DATE NOT NULL,
    category TEXT DEFAULT 'Other',
    description TEXT,
    amount REAL DEFAULT 0,
    receipt_photo TEXT,
    vendor TEXT,
    paid_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Community announcements
  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT,
    is_pinned INTEGER DEFAULT 0,
    expires_at DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Short term lot flag
  addCol("ALTER TABLE lots ADD COLUMN short_term_only INTEGER DEFAULT 0");
  // Seed defaults: C1, C2, D1, D2 as short term
  try {
    db.prepare("UPDATE lots SET short_term_only = 1 WHERE id IN ('C1','C2','D1','D2') AND short_term_only = 0").run();
  } catch {}

  // Vendor directory
  db.run(`CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'Other',
    phone TEXT,
    email TEXT,
    website TEXT,
    address TEXT,
    city TEXT,
    state TEXT DEFAULT 'TX',
    zip TEXT,
    notes TEXT,
    is_favorite INTEGER DEFAULT 0,
    last_used DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed default vendors if empty
  const vendorCount = db.prepare('SELECT COUNT(*) as c FROM vendors').get().c;
  if (vendorCount === 0) {
    const seedVendors = db.prepare('INSERT INTO vendors (name, category, phone, notes, is_favorite) VALUES (?, ?, ?, ?, ?)');
    seedVendors.run('Chambers County EMS', 'Emergency Services', '409-267-2444', 'Emergency medical services', 1);
    seedVendors.run('Anahuac Police Department', 'Emergency Services', '409-267-3534', 'Local police non-emergency', 1);
    seedVendors.run('CenterPoint Energy', 'Electrical', '713-659-2111', 'Electric utility provider', 1);
    seedVendors.run('City of Anahuac Water', 'Water/Utilities', '409-267-3313', 'Municipal water service', 1);
    seedVendors.run('Anahuac Hardware', 'Supplies/Hardware', '409-267-3218', 'Local hardware store', 0);
  }

  // Lot inspections
  db.run(`CREATE TABLE IF NOT EXISTS lot_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    lot_id TEXT,
    photo TEXT,
    notes TEXT,
    severity TEXT DEFAULT 'record',
    status TEXT DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME,
    resolved_at DATETIME,
    fine_amount REAL DEFAULT 0,
    fine_added INTEGER DEFAULT 0
  )`);

  // Health alert tracking
  db.run(`CREATE TABLE IF NOT EXISTS health_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    alerted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  )`);

  // Weather alert tracking
  db.run(`CREATE TABLE IF NOT EXISTS weather_alerts_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nws_alert_id TEXT UNIQUE NOT NULL,
    alert_type TEXT,
    headline TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sms_sent INTEGER DEFAULT 0,
    tenant_count INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0
  )`);

  // Unified auto-message log (birthday, reminder, weather, etc.)
  db.run(`CREATE TABLE IF NOT EXISTS auto_message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_type TEXT NOT NULL,
    recipient_id INTEGER,
    recipient_name TEXT,
    recipient_phone TEXT,
    channel TEXT DEFAULT 'in_app',
    subject TEXT,
    body_preview TEXT,
    status TEXT NOT NULL DEFAULT 'sent',
    dedup_key TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Review requests tracking
  db.run(`CREATE TABLE IF NOT EXISTS review_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    tenant_name TEXT,
    lot_number TEXT,
    method TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'sent'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL,
    amount REAL NOT NULL,
    related_tenant_id INTEGER,
    invoice_id INTEGER,
    payment_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  addCol("ALTER TABLE lots ADD COLUMN lot_type TEXT DEFAULT 'standard'");
  addCol("ALTER TABLE lots ADD COLUMN amenities TEXT");
  addCol("ALTER TABLE lots ADD COLUMN default_rate REAL DEFAULT 295");
  addCol("ALTER TABLE lots ADD COLUMN is_active INTEGER DEFAULT 1");

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

  // A6 is a valid lot — old migration that deleted it has been removed.

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
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'changeme123';
    const hash = bcrypt.hashSync(defaultPassword, 10);
    if (defaultPassword === 'changeme123') console.warn('[database] WARNING: Using default admin password. Set DEFAULT_ADMIN_PASSWORD env var.');
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
    const defaultPin = process.env.DEFAULT_RECOVERY_PIN || '0000';
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('recovery_pin', defaultPin);
    if (defaultPin === '0000') console.warn('[database] WARNING: Using default recovery PIN. Set DEFAULT_RECOVERY_PIN env var.');
  }

  // Ensure recovery_pin exists even on already-seeded databases
  const pinRow = dbWrapper.prepare('SELECT key FROM settings WHERE key = ?').get('recovery_pin');
  if (!pinRow) {
    dbWrapper.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('recovery_pin', process.env.DEFAULT_RECOVERY_PIN || '0000');
  }

  // Default all auto-message toggles to OFF — admin must explicitly enable
  const ensureSetting = dbWrapper.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  ensureSetting.run('auto_birthday_enabled', '0');
  ensureSetting.run('daily_reminder_enabled', '0');
  ensureSetting.run('weather_alerts_enabled', '0');
  ensureSetting.run('review_request_enabled', '1');
  ensureSetting.run('google_review_url', 'https://search.google.com/local/writereview?placeid=ChIJgTxw3Pk-P4YRs2t_UMVRVa4');
  ensureSetting.run('review_request_cooldown_days', '90');

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

  // Backfill checkin records for tenants loaded via seed/import that skipped the checkins table
  const checkinCount = dbWrapper.prepare('SELECT COUNT(*) as c FROM checkins').get().c;
  const activeCount = dbWrapper.prepare('SELECT COUNT(*) as c FROM tenants WHERE is_active = 1').get().c;
  if (checkinCount < activeCount) {
    const backfilled = dbWrapper.prepare(`
      INSERT OR IGNORE INTO checkins (tenant_id, lot_id, check_in_date, status)
      SELECT id, lot_id, COALESCE(move_in_date, date('now')), 'checked_in'
      FROM tenants WHERE is_active = 1 AND id NOT IN (SELECT tenant_id FROM checkins WHERE tenant_id IS NOT NULL)
    `).run();
    const backfilledOut = dbWrapper.prepare(`
      INSERT OR IGNORE INTO checkins (tenant_id, lot_id, check_in_date, check_out_date, status)
      SELECT id, lot_id, COALESCE(move_in_date, date('now')), move_out_date, 'checked_out'
      FROM tenants WHERE is_active = 0 AND move_out_date IS NOT NULL AND id NOT IN (SELECT tenant_id FROM checkins WHERE tenant_id IS NOT NULL)
    `).run();
    console.log(`[database] Backfilled ${backfilled.changes} active + ${backfilledOut.changes} checked-out checkin records`);
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
