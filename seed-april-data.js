/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
// Seed April 2026 invoices for all active tenants based on existing meter readings.
const { db, initializeDatabase } = require('./server/database');

(async () => {
  await initializeDatabase();

  const tenants = db.prepare('SELECT * FROM tenants WHERE is_active = 1').all();
  const invoiceDate = '2026-04-01';
  const dueDate = '2026-04-05';
  const periodStart = '2026-04-01';
  const periodEnd = '2026-04-30';

  let created = 0, skipped = 0;

  for (const t of tenants) {
    const invNum = `INV-2026-04-${String(t.id).padStart(4, '0')}`;
    const exists = db.prepare('SELECT id FROM invoices WHERE invoice_number = ?').get(invNum);
    if (exists) { skipped++; continue; }

    const reading = db.prepare(
      'SELECT * FROM meter_readings WHERE tenant_id = ? AND reading_date = ?'
    ).get(t.id, '2026-04-01');

    const rent = t.rent_type === 'electric_only' ? 0 : (t.monthly_rent || 0);
    const electric = reading ? (reading.electric_charge || 0) : 0;
    const subtotal = rent + electric;
    const total = subtotal;

    db.prepare(
      `INSERT INTO invoices
       (tenant_id, lot_id, invoice_number, invoice_date, due_date,
        billing_period_start, billing_period_end,
        rent_amount, electric_amount, subtotal, total_amount, balance_due, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      t.id, t.lot_id, invNum, invoiceDate, dueDate,
      periodStart, periodEnd,
      rent, electric, subtotal, total, total
    );
    created++;
  }

  console.log(`April 2026 seed complete. Invoices created: ${created}, skipped (existing): ${skipped}`);
  setTimeout(() => process.exit(0), 1000);
})();
