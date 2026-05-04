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
  addCol("ALTER TABLE tenants ADD COLUMN payment_due_day INTEGER DEFAULT 1");
  addCol("ALTER TABLE tenants ADD COLUMN payment_arrangement_notes TEXT");
  addCol("ALTER TABLE invoices ADD COLUMN late_fee_waived INTEGER DEFAULT 0");
  addCol("ALTER TABLE invoices ADD COLUMN late_fee_waived_reason TEXT");

  db.run(`CREATE TABLE IF NOT EXISTS late_fee_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER REFERENCES invoices(id),
    tenant_id INTEGER REFERENCES tenants(id),
    action TEXT NOT NULL,
    amount REAL,
    reason TEXT,
    admin_user TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS late_fee_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    action TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    used_at DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS late_fee_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    notification_sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    email_sent INTEGER DEFAULT 0,
    sms_sent INTEGER DEFAULT 0
  )`);
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
  addCol("ALTER TABLE tenants ADD COLUMN guest_rating TEXT DEFAULT 'green'");
  addCol("ALTER TABLE tenants ADD COLUMN last_portal_login TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN portal_login_count INTEGER DEFAULT 0");

  // Rename rent_type 'standard' to 'monthly' for consistency
  try { db.run("UPDATE tenants SET rent_type = 'monthly' WHERE rent_type = 'standard'"); } catch (e) { /* ignore */ }

  // Stripe customer ID for saved cards
  addCol("ALTER TABLE tenants ADD COLUMN stripe_customer_id TEXT");

  // Guest notes & incidents
  db.run(`CREATE TABLE IF NOT EXISTS guest_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    note_text TEXT NOT NULL,
    note_type TEXT DEFAULT 'general',
    created_by TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS guest_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    incident_date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    lot_id TEXT,
    created_by TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

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

  // Extra photos for hunting/fishing posts (multi-photo support)
  db.run(`CREATE TABLE IF NOT EXISTS catch_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    photo_data TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Per-user reactions on catch posts
  db.run(`CREATE TABLE IF NOT EXISTS catch_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    reaction_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_catch_reactions_unique ON catch_reactions(post_id, tenant_id, reaction_type)'); } catch {}

  // Comments on catch posts
  db.run(`CREATE TABLE IF NOT EXISTS catch_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    tenant_id INTEGER,
    author_name TEXT,
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tenant badges (first catch, biggest catch, etc.)
  db.run(`CREATE TABLE IF NOT EXISTS tenant_badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    badge_type TEXT NOT NULL,
    badge_label TEXT,
    earned_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  addCol("ALTER TABLE hunting_fishing_posts ADD COLUMN is_first_catch INTEGER DEFAULT 0");
  addCol("ALTER TABLE catch_comments ADD COLUMN is_management INTEGER DEFAULT 0");

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
  // Vehicle tracking per lot
  db.run(`CREATE TABLE IF NOT EXISTS tenant_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    vehicle_type TEXT DEFAULT 'car',
    make TEXT,
    model TEXT,
    color TEXT,
    year TEXT,
    license_plate TEXT,
    state TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Occupant tracking
  db.run(`CREATE TABLE IF NOT EXISTS tenant_occupants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    age_or_dob TEXT,
    relationship TEXT DEFAULT 'other',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Authorized persons (allowed to access the site)
  db.run(`CREATE TABLE IF NOT EXISTS tenant_authorized_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    phone TEXT,
    relationship TEXT DEFAULT 'other',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  addCol("ALTER TABLE tenants ADD COLUMN emergency_contact_relationship TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN recurring_extra_occupancy_fee REAL DEFAULT 0");
  addCol("ALTER TABLE invoices ADD COLUMN extra_occupancy_fee REAL DEFAULT 0");

  // SSN last 4 and DL/ID tracking
  addCol("ALTER TABLE tenants ADD COLUMN ssn_last4 TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN dl_number TEXT");
  addCol("ALTER TABLE tenants ADD COLUMN dl_state TEXT");
  addCol("ALTER TABLE tenant_occupants ADD COLUMN ssn_last4 TEXT");
  addCol("ALTER TABLE tenant_occupants ADD COLUMN dl_number TEXT");
  addCol("ALTER TABLE tenant_occupants ADD COLUMN dl_state TEXT");

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

  // Recurring expenses
  db.run(`CREATE TABLE IF NOT EXISTS recurring_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    amount_per_unit REAL DEFAULT 0,
    quantity REAL DEFAULT 1,
    total_amount REAL DEFAULT 0,
    frequency TEXT DEFAULT 'monthly',
    category TEXT DEFAULT 'Other',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Seed WiFi node entry if table is empty
  var recCount = db.prepare("SELECT COUNT(*) as c FROM recurring_expenses").get().c;
  if (recCount === 0) {
    db.prepare("INSERT INTO recurring_expenses (name, description, amount_per_unit, quantity, total_amount, frequency, category) VALUES (?,?,?,?,?,?,?)").run(
      'WiFi Node Electricity', 'Monthly electricity cost per WiFi node installed around the park', 5.00, 6, 30.00, 'monthly', 'Electric/Utilities'
    );
  }

  // Data fix: recalculate balance_due for paid invoices that have stale balance
  db.prepare(`
    UPDATE invoices SET balance_due = CASE
      WHEN amount_paid >= total_amount THEN 0
      ELSE total_amount - COALESCE(amount_paid, 0)
    END
    WHERE status = 'paid' AND balance_due > 0.005
  `).run();

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
  // Vendor directory — new columns for account/login management
  addCol("ALTER TABLE vendors ADD COLUMN account_number TEXT");
  addCol("ALTER TABLE vendors ADD COLUMN login_url TEXT");
  addCol("ALTER TABLE vendors ADD COLUMN username TEXT");
  addCol("ALTER TABLE vendors ADD COLUMN password_encrypted TEXT");
  addCol("ALTER TABLE vendors ADD COLUMN autopay_enrolled INTEGER DEFAULT 0");
  addCol("ALTER TABLE vendors ADD COLUMN payment_method TEXT");

  // Seed default vendors if empty
  const vendorCount = db.prepare('SELECT COUNT(*) as c FROM vendors').get().c;
  if (vendorCount === 0) {
    const seedVendors = db.prepare('INSERT INTO vendors (name, category, phone, notes, is_favorite) VALUES (?, ?, ?, ?, ?)');
    seedVendors.run('Chambers County EMS', 'Emergency Services', '409-267-2444', 'Emergency medical services', 1);
    seedVendors.run('Anahuac Police Department', 'Emergency Services', '409-267-3534', 'Local police non-emergency', 1);
    seedVendors.run('CenterPoint Energy', 'Electrical', '713-659-2111', 'Electric utility provider', 1);
    seedVendors.run('City of Anahuac Water', 'Water/Utilities', '409-267-3313', 'Municipal water service — autopay enrolled', 1);
    seedVendors.run('Anahuac Hardware', 'Supplies/Hardware', '409-267-3218', 'Local hardware store', 0);
  }

  // Expense categories (IRS-ready P&L structure)
  db.run(`CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_category TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
  )`);
  const catCount = db.prepare('SELECT COUNT(*) as c FROM expense_categories').get().c;
  if (catCount === 0) {
    const seedCat = db.prepare('INSERT INTO expense_categories (name, parent_category, sort_order) VALUES (?, ?, ?)');
    const cats = [
      ['EMPLOYEES', null, 1], ['OWNERS/PARTNERS', null, 2],
      ['ELECTRICITY', null, 10], ['VERIZON LAND LINE', null, 11], ['PARK MOBILE PHONE', null, 12],
      ['WATER/SEWER', null, 13], ['DUMPSTER', null, 14], ['ENTERTAINMENT', null, 15],
      ['STARLINK WIFI - GUEST', null, 16], ['MAINTENANCE', null, 17], ['MAINTENANCE REPAIRS', null, 18],
      ['LAWN MOWER PAYMENT', null, 19], ['INSURANCE', null, 20], ['ADVERTISING', null, 21],
      ['UTILITY REPAIRS', null, 22], ['BUILDING MATERIAL', null, 23], ['PROPERTY TAX', null, 24],
      ['MEALS', null, 25], ['PROFESSIONAL SERVICE', null, 26], ['OFFICE SUPPLIES', null, 27],
      ['RV PARK SUPPLIES', null, 28], ['FEES', null, 29], ['APPLIANCE REPAIRS', null, 30],
      ['PEST CONTROL', null, 31], ['ROAD REPAIR MATERIAL', null, 32], ['SECURITY', null, 33],
      ['FUEL', null, 34], ['PLUMBING', null, 35], ['TRACTOR REPAIR', null, 36],
    ];
    cats.forEach(c => seedCat.run(c[0], c[1], c[2]));
  }

  // Expenses — add new columns for vendor linking, status, filing
  addCol("ALTER TABLE expenses ADD COLUMN vendor_id INTEGER");
  addCol("ALTER TABLE expenses ADD COLUMN status TEXT DEFAULT 'filed'");
  addCol("ALTER TABLE expenses ADD COLUMN filed_by TEXT");
  addCol("ALTER TABLE expenses ADD COLUMN filed_at DATETIME");

  // Employee / Owner payments
  db.run(`CREATE TABLE IF NOT EXISTS employee_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    role TEXT DEFAULT 'employee',
    month INTEGER,
    year INTEGER,
    amount REAL DEFAULT 0,
    payment_method TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Bank reconciliation
  db.run(`CREATE TABLE IF NOT EXISTS bank_reconciliation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    beginning_balance REAL DEFAULT 0,
    ending_balance REAL DEFAULT 0,
    is_reconciled INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

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

  db.run(`CREATE TABLE IF NOT EXISTS downtime_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    duration_minutes INTEGER,
    reason TEXT,
    alerts_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  db.run(`CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER REFERENCES payments(id),
    invoice_id INTEGER REFERENCES invoices(id),
    tenant_id INTEGER REFERENCES tenants(id),
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    stripe_refund_id TEXT,
    processed_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      rent_type TEXT DEFAULT 'monthly',
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
  ensureSetting.run('late_fee_type', 'fixed');
  ensureSetting.run('late_fee_percentage', '10');
  ensureSetting.run('late_fee_grace_days', '3');
  ensureSetting.run('late_fee_mode', 'notify');
  ensureSetting.run('late_fee_email', 'anrvpark@gmail.com');
  ensureSetting.run('late_fee_sms_number', '');
  ensureSetting.run('late_fee_email_enabled', '1');
  ensureSetting.run('late_fee_sms_enabled', '0');

  // One-time fix: correct phantom partial/pending invoice statuses
  // Invoices marked 'partial' that are actually fully paid (payments + credits cover total)
  const fixedToPaid = dbWrapper.prepare(`
    UPDATE invoices SET status = 'paid', balance_due = 0
    WHERE status = 'partial'
    AND (COALESCE(amount_paid,0) + COALESCE(credit_applied,0)) >= (total_amount - 0.01)
    AND COALESCE(deleted, 0) = 0
  `).run();
  // Invoices marked 'partial' with zero payments and zero credits (should be pending)
  const fixedToPending = dbWrapper.prepare(`
    UPDATE invoices SET status = 'pending'
    WHERE status = 'partial'
    AND COALESCE(amount_paid, 0) < 0.005
    AND COALESCE(credit_applied, 0) < 0.005
    AND COALESCE(deleted, 0) = 0
  `).run();
  // Invoices marked 'pending' that are actually fully paid
  const fixedPendingToPaid = dbWrapper.prepare(`
    UPDATE invoices SET status = 'paid', balance_due = 0
    WHERE status = 'pending'
    AND (COALESCE(amount_paid,0) + COALESCE(credit_applied,0)) >= (total_amount - 0.01)
    AND COALESCE(deleted, 0) = 0
  `).run();
  const totalFixed = (fixedToPaid.changes || 0) + (fixedToPending.changes || 0) + (fixedPendingToPaid.changes || 0);
  if (totalFixed > 0) {
    console.log(`[db] Invoice status correction: ${fixedToPaid.changes} partial→paid, ${fixedToPending.changes} partial→pending, ${fixedPendingToPaid.changes} pending→paid`);
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

  // --- Data fix: backfill null tenant_id on meter_readings from lot's active tenant ---
  try {
    const nullReadings = dbWrapper.prepare(
      `SELECT mr.id, mr.lot_id FROM meter_readings mr WHERE mr.tenant_id IS NULL AND mr.lot_id IS NOT NULL`
    ).all();
    let fixed = 0;
    for (const r of nullReadings) {
      const tenant = dbWrapper.prepare('SELECT id FROM tenants WHERE lot_id = ? AND is_active = 1 LIMIT 1').get(r.lot_id);
      if (tenant) {
        dbWrapper.prepare('UPDATE meter_readings SET tenant_id = ? WHERE id = ?').run(tenant.id, r.id);
        fixed++;
      }
    }
    if (fixed > 0) console.log(`[database] Fixed ${fixed} meter readings with null tenant_id`);
  } catch (e) { console.error('[database] tenant_id backfill error:', e.message); }

  // --- Data fix: delete zero-use placeholder readings where a real reading exists for the same lot ---
  // Placeholders have kwh_used=0, current_reading=previous_reading (no actual usage), and no photo.
  // A "real" reading has actual usage OR a photo attached.
  try {
    const deleted = dbWrapper.prepare(`
      DELETE FROM meter_readings
      WHERE kwh_used = 0 AND current_reading = previous_reading AND (photo IS NULL OR photo = '')
        AND lot_id IN (
          SELECT DISTINCT lot_id FROM meter_readings
          WHERE kwh_used > 0 OR current_reading != previous_reading OR (photo IS NOT NULL AND photo != '')
        )
    `).run();
    if (deleted.changes > 0) console.log(`[database] Deleted ${deleted.changes} zero-use placeholder readings`);
  } catch (e) { console.error('[database] placeholder cleanup error:', e.message); }

  // ── General Chat ──
  db.run(`CREATE TABLE IF NOT EXISTS general_chat_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    category TEXT DEFAULT 'general',
    message TEXT NOT NULL,
    photo_data TEXT,
    is_management INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS general_chat_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    reaction_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_gc_reactions_unique ON general_chat_reactions(post_id, tenant_id, reaction_type)'); } catch {}
  db.run(`CREATE TABLE IF NOT EXISTS general_chat_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    tenant_id INTEGER,
    author_name TEXT,
    comment TEXT NOT NULL,
    is_management INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Garden Posts ──
  db.run(`CREATE TABLE IF NOT EXISTS garden_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    plant_name TEXT,
    stage TEXT,
    caption TEXT,
    photo_data TEXT,
    is_management INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS garden_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    photo_data TEXT NOT NULL,
    display_order INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS garden_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    reaction_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_garden_reactions_unique ON garden_reactions(post_id, tenant_id, reaction_type)'); } catch {}
  db.run(`CREATE TABLE IF NOT EXISTS garden_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    tenant_id INTEGER,
    author_name TEXT,
    comment TEXT NOT NULL,
    is_management INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Gardening Tips ──
  db.run(`CREATE TABLE IF NOT EXISTS gardening_tips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT,
    is_local INTEGER DEFAULT 0,
    show_date TEXT,
    display_order INTEGER,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS gardening_tips_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tip_id INTEGER NOT NULL,
    shown_date TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Dad Jokes ──
  db.run(`CREATE TABLE IF NOT EXISTS dad_jokes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    joke TEXT NOT NULL,
    category TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS dad_jokes_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    joke_id INTEGER NOT NULL,
    shown_date TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS dad_joke_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    joke_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    reaction_type TEXT NOT NULL,
    shown_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_dj_reactions_unique ON dad_joke_reactions(joke_id, tenant_id, reaction_type, shown_date)'); } catch {}

  // ── Local Restaurants ──
  db.run(`CREATE TABLE IF NOT EXISTS local_restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'american',
    cuisine_type TEXT,
    address TEXT,
    city TEXT DEFAULT 'Anahuac',
    phone TEXT,
    website TEXT,
    hours TEXT,
    price_level TEXT DEFAULT '$',
    description TEXT,
    rating REAL DEFAULT 0,
    distance_miles REAL DEFAULT 0,
    has_delivery INTEGER DEFAULT 0,
    has_takeout INTEGER DEFAULT 1,
    has_dine_in INTEGER DEFAULT 1,
    notable_for TEXT,
    is_recommended INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 0,
    latitude REAL,
    longitude REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed local restaurants if empty
  try {
    var lrCount = db.prepare('SELECT COUNT(*) as c FROM local_restaurants').get().c;
    if (lrCount === 0) {
      var lrIns = db.prepare('INSERT INTO local_restaurants (name,category,cuisine_type,address,city,phone,price_level,rating,distance_miles,notable_for,is_recommended,display_order,has_delivery,has_takeout,has_dine_in) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      var lrData = [
        // Anahuac
        ['The Anahuac Cafe','breakfast','Diner · Breakfast · Lunch','Main St, Anahuac','Anahuac','','$',4.3,0.5,'Classic diner breakfast & burgers',1,1,0,1,1],
        ['Big Daddy\'s Mexican Restaurant','mexican','Mexican','Anahuac','Anahuac','','$',4.2,0.8,'Generous portions, great enchiladas',0,2,0,1,1],
        ['Gator Junction','american','American · Bar & Grill','Anahuac','Anahuac','','$$',4.0,0.6,'Cold beer & fried catfish',0,3,0,1,1],
        ['El Toro Mexican Restaurant','mexican','Mexican','Anahuac','Anahuac','','$',4.1,0.7,'Authentic Tex-Mex, quick service',0,4,0,1,1],
        ['Subway','fast_food','Subs · Sandwiches','Anahuac','Anahuac','','$',3.5,0.9,'Fresh subs, quick lunch',0,10,0,1,1],
        ['Sonic Drive-In','fast_food','Drive-In · Burgers','Anahuac','Anahuac','','$',3.6,0.9,'Shakes, tater tots, classic drive-in',0,11,0,1,0],
        ['Dairy Queen','fast_food','Ice Cream · Burgers','Anahuac','Anahuac','','$',3.7,1.0,'Blizzards & Texas Stop Sign burgers',0,12,0,1,1],
        ['Pizza Hut','pizza','Pizza · Wings','Anahuac','Anahuac','','$',3.5,0.8,'Pizza, pasta, and wings',0,13,1,1,1],
        // Mont Belvieu area
        ['Texas Roadhouse','bbq','Steakhouse · BBQ','Mont Belvieu','Mont Belvieu','','$$',4.4,15.0,'Hand-cut steaks, fall-off-the-bone ribs',1,5,0,1,1],
        ['Whataburger','fast_food','Burgers · Fast Food','Mont Belvieu','Mont Belvieu','','$',4.0,14.0,'Texas classic — Honey Butter Chicken Biscuit',0,14,0,1,1],
        ['Chick-fil-A','fast_food','Chicken · Fast Food','Mont Belvieu','Mont Belvieu','','$',4.5,15.0,'Best chicken sandwich, always friendly',0,15,0,1,1],
        ['Chili\'s Grill & Bar','american','American · Casual Dining','Mont Belvieu','Mont Belvieu','','$$',3.9,15.0,'Casual dining, good happy hour',0,16,0,1,1],
        // Winnie area
        ['Al-T\'s Cajun Restaurant','cajun','Cajun · Seafood','Winnie','Winnie','','$$',4.6,20.0,'Famous crawfish, boudin & gumbo — a MUST try!',1,6,0,1,1],
        ['The Boondocks','american','American · Bar & Grill','Winnie','Winnie','','$$',4.3,22.0,'Local favorite, great steaks & burgers',0,7,0,1,1],
        ['Tia Juanita\'s Fish Camp','seafood','Seafood · Cajun · Mexican','Winnie','Winnie','','$$',4.5,21.0,'Gulf seafood, tacos, incredible shrimp',1,8,0,1,1],
        // Beach City / Cove
        ['Roosters Steakhouse','bbq','Steakhouse · BBQ','Beach City','Beach City','','$$',4.2,12.0,'Hearty steaks in a country setting',0,9,0,1,1],
      ];
      lrData.forEach(function(r) { lrIns.run(...r); });
    }
  } catch (e) { console.log('[db] restaurant seed:', e.message); }

  // ── Content Cache (news, weather, traffic) ──
  db.run(`CREATE TABLE IF NOT EXISTS content_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT UNIQUE NOT NULL,
    data TEXT,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Push notification subscriptions
  db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    is_admin INTEGER DEFAULT 0,
    endpoint TEXT NOT NULL,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    user_agent TEXT,
    device_label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME
  )`);

  // Notification log & inbox
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    is_admin INTEGER DEFAULT 0,
    type TEXT,
    title TEXT,
    body TEXT,
    url TEXT,
    priority TEXT DEFAULT 'normal',
    is_read INTEGER DEFAULT 0,
    is_sent INTEGER DEFAULT 0,
    sent_at DATETIME,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Notification preferences per tenant
  db.run(`CREATE TABLE IF NOT EXISTS notification_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER UNIQUE,
    enabled INTEGER DEFAULT 1,
    invoices INTEGER DEFAULT 1,
    payments INTEGER DEFAULT 1,
    community INTEGER DEFAULT 1,
    maintenance INTEGER DEFAULT 1,
    announcements INTEGER DEFAULT 1,
    weather_alerts INTEGER DEFAULT 1,
    quiet_hours_enabled INTEGER DEFAULT 1,
    quiet_start_hour INTEGER DEFAULT 22,
    quiet_end_hour INTEGER DEFAULT 7,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Quarter request system
  db.run(`CREATE TABLE IF NOT EXISTS quarter_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    when_needed TEXT DEFAULT 'asap',
    preferred_time TEXT,
    tenant_note TEXT,
    status TEXT DEFAULT 'pending',
    admin_response TEXT,
    admin_responded_at DATETIME,
    responded_by TEXT,
    confirmed_time TEXT,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS quarter_request_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    sender_type TEXT NOT NULL,
    sender_name TEXT,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  saveDb();
  console.log('Database initialized successfully');

  // === STARTUP HEALTH CHECK ===
  runStartupHealthCheck();
}

// Validate that required columns exist in a table. Returns list of missing columns.
function validateColumns(tableName, requiredColumns) {
  const missing = [];
  try {
    const info = db.exec(`PRAGMA table_info(${tableName})`);
    const existing = info[0] ? info[0].values.map(r => r[1]) : [];
    for (const col of requiredColumns) {
      if (!existing.includes(col)) missing.push(col);
    }
  } catch (e) {
    console.error(`[CRITICAL] Cannot read table schema for ${tableName}: ${e.message}`);
    return requiredColumns; // assume all missing
  }
  return missing;
}

function runStartupHealthCheck() {
  console.log('[health-check] Running startup validation...');
  let issues = 0;

  // 1. Validate critical table columns
  const criticalTables = {
    invoices: ['id', 'tenant_id', 'invoice_number', 'total_amount', 'balance_due', 'status', 'amount_paid',
      'rent_amount', 'electric_amount', 'mailbox_fee', 'misc_fee', 'extra_occupancy_fee', 'late_fee',
      'refund_amount', 'refund_description', 'credit_applied'],
    tenants: ['id', 'first_name', 'last_name', 'lot_id', 'phone', 'email', 'is_active'],
    meter_readings: ['id', 'lot_id', 'reading_date', 'current_reading', 'previous_reading', 'kwh_used', 'photo'],
    payments: ['id', 'tenant_id', 'invoice_id', 'payment_date', 'amount', 'payment_method'],
    vendors: ['id', 'name', 'category', 'phone', 'email'],
    expenses: ['id', 'expense_date', 'category', 'amount', 'vendor', 'vendor_id', 'status'],
    expense_categories: ['id', 'name', 'is_active'],
    employee_payments: ['id', 'employee_name', 'amount', 'month', 'year'],
    bank_reconciliation: ['id', 'month', 'year', 'beginning_balance', 'ending_balance'],
    downtime_log: ['id', 'start_time', 'reason'],
  };

  for (const [table, cols] of Object.entries(criticalTables)) {
    const missing = validateColumns(table, cols);
    if (missing.length > 0) {
      console.error(`[CRITICAL] Table "${table}" is missing columns: ${missing.join(', ')} — portal queries may crash!`);
      issues++;
    }
  }

  // 2. Test the exact portal /me invoice query (the one that just broke production)
  try {
    db.exec(`SELECT id, invoice_number, invoice_date, total_amount, balance_due, status,
      rent_amount, electric_amount, mailbox_fee, misc_fee,
      extra_occupancy_fee, late_fee, refund_amount, refund_description, credit_applied
    FROM invoices LIMIT 0`);
  } catch (e) {
    console.error(`[CRITICAL] Portal /me invoice query will CRASH: ${e.message}`);
    issues++;
  }

  // 3. Test portal balance query
  try {
    db.exec(`SELECT COALESCE(SUM(balance_due), 0) as total FROM invoices WHERE tenant_id = -1 AND status IN ('pending','partial') AND COALESCE(deleted,0)=0`);
  } catch (e) {
    console.error(`[CRITICAL] Portal balance query will CRASH: ${e.message}`);
    issues++;
  }

  // 4. Test dashboard stats query
  try {
    db.exec(`SELECT COUNT(*) as count FROM lots`);
    db.exec(`SELECT COUNT(*) as count FROM tenants WHERE is_active = 1`);
    db.exec(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')`);
  } catch (e) {
    console.error(`[CRITICAL] Dashboard stats query will CRASH: ${e.message}`);
    issues++;
  }

  if (issues === 0) {
    console.log('[health-check] All startup checks passed ✓');
  } else {
    console.error(`[CRITICAL] ${issues} startup check(s) FAILED — server will start but some features may be broken!`);
  }
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
