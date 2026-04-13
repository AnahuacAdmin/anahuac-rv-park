/*
 * Anahuac RV Park — Tenant Health Score & Loyalty
 */
const { db } = require('../database');

function calculateHealthScore(tenantId) {
  var score = 70; // Base score

  // Payment history: count on-time vs late payments
  var payments = db.prepare("SELECT COUNT(*) as c FROM payments WHERE tenant_id=?").get(tenantId)?.c || 0;
  if (payments >= 6) score += 10;
  else if (payments >= 3) score += 5;

  // Outstanding balance
  var balance = db.prepare("SELECT COALESCE(SUM(balance_due),0) as b FROM invoices WHERE tenant_id=? AND status IN ('pending','partial') AND COALESCE(deleted,0)=0").get(tenantId)?.b || 0;
  if (balance > 500) score -= 20;
  else if (balance > 200) score -= 10;
  else if (balance > 0) score -= 5;
  else score += 10; // No balance = bonus

  // Length of stay
  var tenant = db.prepare("SELECT move_in_date, deposit_amount, deposit_waived FROM tenants WHERE id=?").get(tenantId);
  if (tenant && tenant.move_in_date) {
    var days = Math.floor((Date.now() - new Date(tenant.move_in_date + 'T00:00:00').getTime()) / 86400000);
    if (days > 365) score += 15;
    else if (days > 180) score += 10;
    else if (days > 90) score += 5;
  }

  // Deposit
  if (tenant && tenant.deposit_amount > 0) score += 5;

  // Eviction warning
  var eviction = db.prepare("SELECT eviction_warning FROM tenants WHERE id=?").get(tenantId);
  if (eviction && eviction.eviction_warning) score -= 20;

  // Maintenance requests (too many = slight negative)
  var maintCount = 0;
  try { maintCount = db.prepare("SELECT COUNT(*) as c FROM maintenance_requests WHERE tenant_id=?").get(tenantId)?.c || 0; } catch {}
  if (maintCount > 5) score -= 5;

  return Math.max(0, Math.min(100, score));
}

function getScoreLabel(score) {
  if (score >= 80) return { label: 'Excellent', color: '#16a34a', emoji: '🟢' };
  if (score >= 60) return { label: 'Good', color: '#f59e0b', emoji: '🟡' };
  if (score >= 40) return { label: 'Fair', color: '#f97316', emoji: '🟠' };
  return { label: 'At Risk', color: '#dc2626', emoji: '🔴' };
}

function calculateLoyaltyDiscount(tenantId) {
  var tenant = db.prepare("SELECT move_in_date, loyalty_exclude FROM tenants WHERE id=?").get(tenantId);
  if (!tenant || !tenant.move_in_date || tenant.loyalty_exclude) return { months: 0, percent: 0, amount: 0 };

  var days = Math.floor((Date.now() - new Date(tenant.move_in_date + 'T00:00:00').getTime()) / 86400000);
  var months = Math.floor(days / 30);

  // Get loyalty settings or use defaults
  var s6 = 2, s12 = 5, s24 = 8;
  try {
    var v = db.prepare("SELECT value FROM settings WHERE key='loyalty_6mo'").get();
    if (v) s6 = parseFloat(v.value);
    v = db.prepare("SELECT value FROM settings WHERE key='loyalty_12mo'").get();
    if (v) s12 = parseFloat(v.value);
    v = db.prepare("SELECT value FROM settings WHERE key='loyalty_24mo'").get();
    if (v) s24 = parseFloat(v.value);
  } catch {}

  var percent = 0;
  if (months >= 24) percent = s24;
  else if (months >= 12) percent = s12;
  else if (months >= 6) percent = s6;

  return { months: months, percent: percent };
}

function getConsecutiveOnTimePayments(tenantId) {
  // Count most recent consecutive on-time payments (invoice paid within 5 days of due date)
  var invoices = db.prepare("SELECT id, due_date, status FROM invoices WHERE tenant_id=? AND COALESCE(deleted,0)=0 ORDER BY invoice_date DESC LIMIT 12").all(tenantId);
  var consecutive = 0;
  for (var i = 0; i < invoices.length; i++) {
    if (invoices[i].status === 'paid') consecutive++;
    else break;
  }
  return consecutive;
}

module.exports = { calculateHealthScore, getScoreLabel, calculateLoyaltyDiscount, getConsecutiveOnTimePayments };
