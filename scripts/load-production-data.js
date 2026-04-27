/*
 * Load production data for Anahuac RV Park — April 2026
 * Replaces all test data with real tenant/billing records.
 * Run: node scripts/load-production-data.js
 */
const { db, initializeDatabase, saveDb } = require('../server/database');

async function main() {
  await initializeDatabase();
  console.log('[load] Database initialized');

  // =========================================================
  // STEP 1: Clear test data (preserve users, settings, lots)
  // =========================================================
  const clearTables = [
    'messages', 'auto_message_log', 'payments', 'invoices',
    'meter_readings', 'checkins', 'tenants',
    'community_posts', 'community_replies',
    'maintenance_requests', 'announcements',
    'hunting_fishing_posts', 'bird_sightings', 'lost_found_pets',
  ];
  for (const t of clearTables) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch (e) { /* table may not exist */ }
  }
  console.log('[load] Cleared test data from:', clearTables.join(', '));

  // =========================================================
  // STEP 2: Update lot statuses
  // =========================================================
  const lotStatuses = {
    A1: 'owner_reserved', A2: 'occupied', A3: 'occupied', A4: 'occupied',
    A5: 'occupied',
    B1: 'owner_reserved', B2: 'occupied', B3: 'vacant', B4: 'occupied',
    C1: 'vacant', C2: 'vacant', C3: 'occupied',
    D1: 'vacant', D2: 'vacant', D3: 'occupied',
    E1: 'occupied', E2: 'occupied', E3: 'occupied', E4: 'occupied',
    F1: 'occupied', F2: 'occupied', F3: 'occupied', F4: 'vacant', F5: 'occupied',
    G1: 'occupied', G2: 'occupied', G3: 'occupied', G4: 'occupied', G5: 'occupied',
    H1: 'vacant', H2: 'occupied', H3: 'occupied', H4: 'occupied', H5: 'occupied', H6: 'occupied',
  };
  for (const [lotId, status] of Object.entries(lotStatuses)) {
    db.prepare('UPDATE lots SET status = ? WHERE id = ?').run(status, lotId);
  }
  // Remove lots not in the 35-lot layout
  const validLots = Object.keys(lotStatuses);
  const allLots = db.prepare('SELECT id FROM lots').all();
  for (const { id } of allLots) {
    if (!validLots.includes(id)) {
      db.prepare('DELETE FROM lots WHERE id = ?').run(id);
    }
  }
  // Ensure H3-H6 lots exist (may not be in seed data)
  const ensureLots = [
    ['H3', 'H', 3], ['H4', 'H', 4], ['H5', 'H', 5], ['H6', 'H', 6],
  ];
  for (const [id, row, num] of ensureLots) {
    const exists = db.prepare('SELECT id FROM lots WHERE id = ?').get(id);
    if (!exists) {
      db.prepare('INSERT INTO lots (id, row_letter, lot_number, status) VALUES (?, ?, ?, ?)').run(id, row, num, lotStatuses[id] || 'vacant');
    }
  }
  console.log('[load] Updated lot statuses');

  // =========================================================
  // STEP 3: Insert tenants
  // =========================================================
  const insertTenant = db.prepare(`
    INSERT INTO tenants (lot_id, first_name, last_name, monthly_rent, rent_type, move_in_date, is_active, notes, recurring_mailbox_fee, recurring_credit, recurring_credit_description, deposit_amount, deposit_waived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tenants = [
    // [lot_id, first, last, rent, type, move_in, is_active, notes, mailbox, credit, credit_desc, deposit_amt, deposit_waived]
    ['A1', 'Our', 'Space',           0,   'electric_only', '2026-01-01', 1, 'OUR SPACE (owner/reserved)', 0, 0, null, 0, 1],
    ['A2', 'Brandy', 'McDaniel',     295, 'standard', '2026-01-01', 1, null, 0, 0, null, 200, 0],
    ['A3', 'Curtis & Nicole', 'McKinzy', 295, 'standard', '2026-01-01', 1, null, 5, 0, null, 200, 0],
    ['A4', 'Fredrick', 'Tham',       295, 'standard', '2026-01-01', 1, '$25 credit for help mowing spaces', 5, 25, 'Mowing credit', 200, 0],
    ['A5', 'Ruth', 'Morrison',       295, 'standard', '2026-01-01', 1, 'Overpayment credit $0.75 from prev month', 0, 0.75, 'Overpayment prev month', 0, 1],
    ['H3', 'Justin', 'Martin',       295, 'standard', '2026-01-01', 1, null, 0, 0, null, 200, 0],
    ['H4', 'Aislinn', 'Nygaard',     350, 'standard', '2026-01-01', 1, '$4 unpaid balance from prev month', 0, 0, null, 0, 1],
    ['H5', 'Shawna', 'Nygaard',      350, 'standard', '2026-01-01', 1, 'Overpayment credit $23.55 from prev month', 5, 23.55, 'Overpayment prev month', 0, 1],
    ['H6', 'Jolie', 'Hebert',        375, 'standard', '2026-01-01', 1, null, 5, 0, null, 200, 0],
    ['B1', 'Henry', '(Owner)',        0,   'electric_only', '2026-01-01', 1, 'Owner/management space', 0, 0, null, 0, 1],
    ['B2', 'David', 'Carroll',        295, 'standard', '2026-01-01', 1, null, 0, 0, null, 0, 1],
    ['B4', 'Michael & Fanci', 'Hebert', 295, 'standard', '2026-01-01', 1, null, 0, 0, null, 200, 0],
    ['C3', 'Amy', 'Gilmore',         295, 'standard', '2026-01-01', 1, null, 5, 0, null, 200, 0],
    ['D3', 'Kenneth', 'Preston',     295, 'standard', '2026-01-01', 1, null, 5, 0, null, 200, 0],
    ['E1', 'Lucas', 'Carson',        295, 'standard', '2026-01-01', 1, null, 5, 0, null, 200, 0],
    ['E2', 'Jamie', 'Linares',       295, 'standard', '2026-01-01', 1, 'Overpayment credit $0.60 from prev month', 0, 0.60, 'Overpayment prev month', 200, 0],
    ['E3', 'Eric', 'Tutt',           295, 'standard', '2026-01-01', 1, null, 0, 0, null, 200, 0],
    ['E4', 'Jan & Rodney', 'Kimmons', 200, 'standard', '2026-01-01', 1, null, 5, 0, null, 0, 1],
    ['F1', 'Richard', 'Desmit',      295, 'standard', '2026-01-01', 1, null, 5, 0, null, 200, 0],
    ['F2', 'Paige', 'Curbow',        0,   'electric_only', '2026-01-01', 1, null, 0, 0, null, 0, 1],
    ['F3', 'Darla', 'Willcox',       295, 'standard', '2026-01-01', 1, null, 0, 0, null, 200, 0],
    ['F5', 'Dennis', 'Collins',      295, 'standard', '2026-01-01', 1, null, 5, 0, null, 200, 0],
    ['G1', 'John', 'Phelps',        295, 'standard', '2026-01-01', 1, null, 0, 0, null, 200, 0],
    ['G2', 'Rodney', 'Woods',       295, 'standard', '2026-01-01', 1, 'Overpayment credit $0.75 from prev month', 5, 0.75, 'Overpayment prev month', 200, 0],
    ['G3', 'David', 'Williams',     295, 'standard', '2026-01-01', 1, null, 0, 0, null, 200, 0],
    ['G4', 'Keisha', 'Lavergne',    295, 'standard', '2026-01-01', 1, null, 0, 0, null, 200, 0],
    ['G5', 'Jim', 'Morse',          295, 'standard', '2026-01-01', 1, '$20 quarters fee charged', 5, 0, null, 200, 0],
    ['H2', 'Ezequiel', 'Arellano',  295, 'standard', '2026-01-01', 1, null, 0, 0, null, 200, 0],
  ];

  const tenantIds = {}; // lot_id -> tenant row id
  let occupied = 0, reserved = 0;
  for (const t of tenants) {
    const result = insertTenant.run(...t);
    tenantIds[t[0]] = result.lastInsertRowid;
    if (t[3] === 0) reserved++; else occupied++;
  }
  console.log(`[load] Inserted ${tenants.length} tenants (${occupied} paying, ${reserved} reserved/owner)`);

  // =========================================================
  // STEP 4: Insert meter readings (March prev + April current)
  // =========================================================
  const readings = [
    // [lot_id, prev, curr]
    ['A1', 21371, 21411], ['A2', 14954, 14954], ['A3', 57336, 57884],
    ['A4', 37435, 37641], ['A5', 69085, 69218],
    ['H3', 33235, 33888], ['H4', 44260, 45493], ['H5', 65910, 67051], ['H6', 21953, 22429],
    ['B1', 33714, 34012], ['B2', 20855, 21720], ['B3', 19141, 19141],
    ['B4', 49812, 50441], ['C1', 53701, 53730], ['C2', 48406, 48468],
    ['C3', 93636, 94155], ['D1', 46287, 46294], ['D2', 20581, 20581],
    ['D3', 61672, 62254], ['E1', 65197, 65815], ['E2', 26736, 27402],
    ['E3', 32992, 32992], ['E4', 11416, 11830], ['F1', 18035, 18453],
    ['F2', 10998, 11203], ['F3', 53125, 53622], ['F4', 4767, 4767],
    ['F5', 62115, 62560], ['G1', 59887, 60238], ['G2', 45992, 46490],
    ['G3', 46461, 46952], ['G4', 49182, 49589], ['G5', 25073, 25587],
    ['H1', 18587, 18587], ['H2', 36507, 36874],
  ];

  const RATE = 0.15;
  const insertReading = db.prepare(`
    INSERT INTO meter_readings (lot_id, tenant_id, reading_date, previous_reading, current_reading, kwh_used, rate_per_kwh, electric_charge)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let readingCount = 0;
  for (const [lotId, prev, curr] of readings) {
    const kwh = curr - prev;
    const charge = Math.round(kwh * RATE * 100) / 100;
    const tid = tenantIds[lotId] || null;
    // Insert the April reading (previous = March 1, current = April 1)
    insertReading.run(lotId, tid, '2026-04-01', prev, curr, kwh, RATE, charge);
    readingCount++;
  }
  console.log(`[load] Inserted ${readingCount} meter readings (April 2026)`);

  // =========================================================
  // STEP 5: Create April 2026 invoices — ALL PAID
  // =========================================================
  // Invoice breakdown: [lot_id, rent, electric, mailbox, other_charges, other_desc, credit, total]
  const invoiceData = [
    ['A1', 0,   6.00,   0, 0,  null,              0,     6.00],
    ['A2', 295, 0,      0, 0,  null,              0,     295.00],
    ['A3', 295, 82.20,  5, 0,  null,              0,     382.20],
    ['A4', 295, 30.90,  5, 0,  null,              25,    305.90],
    ['A5', 295, 19.95,  0, 0,  null,              0.75,  314.20],
    ['H3', 295, 97.95,  0, 0,  null,              0,     392.95],
    ['H4', 350, 184.95, 0, 4,  'Unpaid prev balance', 0, 538.95],
    ['H5', 350, 171.15, 5, 0,  null,              23.55, 502.60],
    ['H6', 375, 71.40,  5, 0,  null,              0,     451.40],
    ['B1', 0,   44.70,  0, 0,  null,              0,     44.70],
    ['B2', 295, 129.75, 0, 0,  null,              0,     424.75],
    ['B4', 295, 94.35,  0, 0,  null,              0,     389.35],
    ['C3', 295, 77.85,  5, 0,  null,              0,     377.85],
    ['D3', 295, 87.30,  5, 0,  null,              0,     387.30],
    ['E1', 295, 92.70,  5, 0,  null,              0,     392.70],
    ['E2', 295, 99.90,  0, 0,  null,              0.60,  394.30],
    ['E3', 295, 0,      0, 0,  null,              0,     295.00],
    ['E4', 200, 62.10,  5, 0,  null,              0,     267.10],
    ['F1', 295, 62.70,  5, 0,  null,              0,     362.70],
    ['F2', 0,   30.75,  0, 0,  null,              0,     30.75],
    ['F3', 295, 74.55,  0, 0,  null,              0,     369.55],
    ['F5', 295, 66.75,  5, 0,  null,              0,     366.75],
    ['G1', 295, 52.65,  0, 0,  null,              0,     347.65],
    ['G2', 295, 74.70,  5, 0,  null,              0.75,  373.95],
    ['G3', 295, 73.65,  0, 0,  null,              0,     368.65],
    ['G4', 295, 61.05,  0, 0,  null,              0,     356.05],
    ['G5', 295, 77.10,  5, 20, 'Quarters fee',    0,     397.10],
    ['H2', 295, 55.05,  0, 0,  null,              0,     350.05],
  ];

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (tenant_id, lot_id, invoice_number, invoice_date, due_date,
      billing_period_start, billing_period_end, rent_amount, electric_amount,
      mailbox_fee, other_charges, other_description, refund_amount, refund_description,
      subtotal, late_fee, total_amount, amount_paid, balance_due, status, credit_applied)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPayment = db.prepare(`
    INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let invoiceCount = 0;
  let totalIncome = 0;
  for (const [lotId, rent, electric, mailbox, other, otherDesc, credit, total] of invoiceData) {
    const tid = tenantIds[lotId];
    if (!tid) { console.warn(`  [skip] No tenant for lot ${lotId}`); continue; }

    const invNum = `INV-2026-04-${String(invoiceCount + 1).padStart(3, '0')}`;
    const subtotal = rent + electric + mailbox + other - credit;

    const result = insertInvoice.run(
      tid, lotId, invNum,
      '2026-04-01', '2026-04-04',
      '2026-04-01', '2026-05-01',
      rent, electric, mailbox,
      other, otherDesc,
      credit, credit > 0 ? 'Credit applied' : null,
      subtotal, 0, total, total, 0, 'paid', credit
    );

    // Create matching payment record
    insertPayment.run(tid, result.lastInsertRowid, '2026-04-01', total, 'cash', 'April 2026 payment');

    invoiceCount++;
    totalIncome += total;
  }
  console.log(`[load] Created ${invoiceCount} April invoices — all marked PAID`);
  console.log(`[load] Total income: $${totalIncome.toFixed(2)}`);

  // =========================================================
  // STEP 6: Set park settings
  // =========================================================
  const settings = {
    electric_rate: '0.15',
    deposit_amount: '200',
    late_fee: '25',
    late_fee_days: '3',
    credit_card_fee: '0.03',
    park_name: 'Anahuac RV Park, LLC',
    park_address: '1003 Davis Ave, Anahuac, TX 77514',
    park_phone: '409-267-6603',
    park_email: 'support@anrvpark.com',
    days_in_april: '30',
  };

  const upsertSetting = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
  for (const [key, value] of Object.entries(settings)) {
    upsertSetting.run(key, value);
  }
  console.log('[load] Park settings updated');

  // =========================================================
  // STEP 7: Save and report
  // =========================================================
  saveDb();
  console.log('[load] Database saved to disk');

  const vacantCount = Object.values(lotStatuses).filter(s => s === 'vacant').length;
  const occupiedCount = Object.values(lotStatuses).filter(s => s === 'occupied').length;
  const totalElectric = readings.reduce((sum, [, prev, curr]) => sum + (curr - prev) * RATE, 0);

  console.log('\n========== SUMMARY ==========');
  console.log(`Lots: ${Object.keys(lotStatuses).length} total (${occupiedCount} occupied, ${vacantCount} vacant, ${Object.keys(lotStatuses).length - occupiedCount - vacantCount} reserved)`);
  console.log(`Tenants: ${tenants.length} inserted`);
  console.log(`Meter readings: ${readingCount} (April 2026)`);
  console.log(`Invoices: ${invoiceCount} — all PAID`);
  console.log(`Total income: $${totalIncome.toFixed(2)}`);
  console.log(`Total electric cost: $${totalElectric.toFixed(2)}`);
  console.log(`Net profit: $${(totalIncome - totalElectric).toFixed(2)}`);
  console.log('=============================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('[load] FATAL:', err);
  process.exit(1);
});
