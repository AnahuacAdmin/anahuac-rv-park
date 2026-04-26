/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

// Get credit transaction history for a tenant
router.get('/history/:tenantId', (req, res) => {
  const rows = db.prepare(`
    SELECT ct.*, t.first_name || ' ' || t.last_name as related_tenant_name
    FROM credit_transactions ct
    LEFT JOIN tenants t ON t.id = ct.related_tenant_id
    WHERE ct.tenant_id = ?
    ORDER BY ct.created_at DESC
  `).all(req.params.tenantId);
  res.json(rows);
});

// Get all tenants with credit balances (dashboard summary)
router.get('/summary', (req, res) => {
  const tenants = db.prepare(`
    SELECT id, first_name, last_name, lot_id, credit_balance
    FROM tenants WHERE credit_balance > 0.005 AND is_active = 1
    ORDER BY credit_balance DESC
  `).all();
  const total = tenants.reduce((s, t) => s + Number(t.credit_balance), 0);
  res.json({ tenants, total: +total.toFixed(2) });
});

// Transfer credit between tenants
router.post('/transfer', (req, res) => {
  const { from_tenant_id, to_tenant_id, amount, reason } = req.body;
  if (!from_tenant_id || !to_tenant_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid transfer parameters' });
  }
  if (from_tenant_id === to_tenant_id) {
    return res.status(400).json({ error: 'Cannot transfer to the same tenant' });
  }

  const fromTenant = db.prepare('SELECT id, first_name, last_name, lot_id, credit_balance FROM tenants WHERE id = ?').get(from_tenant_id);
  const toTenant = db.prepare('SELECT id, first_name, last_name, lot_id FROM tenants WHERE id = ?').get(to_tenant_id);
  if (!fromTenant || !toTenant) return res.status(404).json({ error: 'Tenant not found' });

  const available = Number(fromTenant.credit_balance) || 0;
  if (amount > available + 0.005) {
    return res.status(400).json({ error: `Insufficient credit. Available: $${available.toFixed(2)}` });
  }

  const transferAmount = +Math.min(amount, available).toFixed(2);
  const fromName = `${fromTenant.first_name} ${fromTenant.last_name}`;
  const toName = `${toTenant.first_name} ${toTenant.last_name}`;
  const noteBase = reason ? reason : `Transfer between tenants`;

  // Deduct from source
  db.prepare('UPDATE tenants SET credit_balance = credit_balance - ? WHERE id = ?').run(transferAmount, from_tenant_id);
  db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, related_tenant_id, notes)
    VALUES (?, 'transfer_out', ?, ?, ?)`).run(from_tenant_id, -transferAmount, to_tenant_id,
    `Credit transferred to ${toName} (${toTenant.lot_id}). ${noteBase}`);

  // Add to destination
  db.prepare('UPDATE tenants SET credit_balance = credit_balance + ? WHERE id = ?').run(transferAmount, to_tenant_id);
  db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, related_tenant_id, notes)
    VALUES (?, 'transfer_in', ?, ?, ?)`).run(to_tenant_id, transferAmount, from_tenant_id,
    `Credit received from ${fromName} (${fromTenant.lot_id}). ${noteBase}`);

  res.json({
    success: true,
    transferred: transferAmount,
    from: { name: fromName, lot: fromTenant.lot_id, new_balance: +(available - transferAmount).toFixed(2) },
    to: { name: toName, lot: toTenant.lot_id },
  });
});

// Refund credit (record that credit was returned to tenant)
router.post('/refund', (req, res) => {
  const { tenant_id, amount, payment_method, reference_number, reason } = req.body;
  if (!tenant_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid refund parameters' });
  }

  const tenant = db.prepare('SELECT id, credit_balance, first_name, last_name FROM tenants WHERE id = ?').get(tenant_id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const available = Number(tenant.credit_balance) || 0;
  if (amount > available + 0.005) {
    return res.status(400).json({ error: `Insufficient credit. Available: $${available.toFixed(2)}` });
  }

  const refundAmount = +Math.min(amount, available).toFixed(2);

  db.prepare('UPDATE tenants SET credit_balance = credit_balance - ? WHERE id = ?').run(refundAmount, tenant_id);
  db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, notes)
    VALUES (?, 'refund', ?, ?)`).run(tenant_id, -refundAmount,
    `Credit refund: $${refundAmount.toFixed(2)} via ${payment_method || 'cash'}${reference_number ? ' (Ref: ' + reference_number + ')' : ''}${reason ? '. ' + reason : ''}`);

  // Record as negative payment for audit trail
  db.prepare('INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes) VALUES (?, NULL, ?, ?, ?, ?, ?)')
    .run(tenant_id, new Date().toISOString().split('T')[0], -refundAmount, payment_method || 'cash', reference_number || 'CREDIT-REFUND', `Credit balance refund${reason ? ': ' + reason : ''}`);

  res.json({ success: true, refunded: refundAmount, new_balance: +(available - refundAmount).toFixed(2) });
});

// Manually apply credit to an unpaid invoice
router.post('/apply-to-invoice', (req, res) => {
  const { tenant_id, invoice_id, amount } = req.body;
  if (!tenant_id || !invoice_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  const tenant = db.prepare('SELECT credit_balance FROM tenants WHERE id = ?').get(tenant_id);
  const invoice = db.prepare('SELECT id, balance_due, total_amount, amount_paid FROM invoices WHERE id = ? AND tenant_id = ?').get(invoice_id, tenant_id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const available = Number(tenant.credit_balance) || 0;
  const invoiceDue = Number(invoice.balance_due) || 0;
  const applyAmount = +Math.min(amount, available, invoiceDue).toFixed(2);
  if (applyAmount <= 0) return res.status(400).json({ error: 'Nothing to apply' });

  // Deduct from credit balance
  db.prepare('UPDATE tenants SET credit_balance = credit_balance - ? WHERE id = ?').run(applyAmount, tenant_id);

  // Apply to invoice
  const newPaid = +(Number(invoice.amount_paid) + applyAmount).toFixed(2);
  const newBalance = +(Number(invoice.total_amount) - newPaid).toFixed(2);
  const newStatus = newBalance <= 0.005 ? 'paid' : 'partial';
  db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ?, credit_applied = credit_applied + ? WHERE id = ?')
    .run(newPaid, Math.max(0, newBalance), newStatus, applyAmount, invoice_id);

  // Record as payment
  db.prepare('INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(tenant_id, invoice_id, new Date().toISOString().split('T')[0], applyAmount, 'Credit', 'CREDIT-APPLY', 'Applied from tenant credit balance');

  // Log credit transaction
  db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, invoice_id, notes)
    VALUES (?, 'applied_to_invoice', ?, ?, ?)`).run(tenant_id, -applyAmount, invoice_id,
    `Applied $${applyAmount.toFixed(2)} credit to invoice`);

  // Clear eviction flags if fully paid
  if (newBalance <= 0.005) {
    const unpaid = db.prepare(
      "SELECT COUNT(*) as cnt FROM invoices WHERE tenant_id = ? AND balance_due > 0.005 AND status IN ('pending','partial') AND COALESCE(deleted,0) = 0"
    ).get(tenant_id);
    if (!unpaid || unpaid.cnt === 0) {
      db.prepare('UPDATE tenants SET eviction_warning = 0, eviction_notified = 0, eviction_paused = 0, eviction_pause_note = NULL WHERE id = ?').run(tenant_id);
    }
  }

  res.json({ success: true, applied: applyAmount, new_credit: +(available - applyAmount).toFixed(2), new_invoice_balance: Math.max(0, newBalance) });
});

// Add credit manually (admin adjustment)
router.post('/add', (req, res) => {
  const { tenant_id, amount, reason } = req.body;
  if (!tenant_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  db.prepare('UPDATE tenants SET credit_balance = credit_balance + ? WHERE id = ?').run(amount, tenant_id);
  db.prepare(`INSERT INTO credit_transactions (tenant_id, transaction_type, amount, notes)
    VALUES (?, 'manual_add', ?, ?)`).run(tenant_id, amount, reason || 'Manual credit adjustment');

  res.json({ success: true });
});

module.exports = router;
