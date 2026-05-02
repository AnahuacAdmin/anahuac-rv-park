/*
 * Anahuac RV Park — Profit & Loss Report API
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

// Full P&L report for a year
router.get('/', (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const months = [];

  for (let m = 1; m <= 12; m++) {
    const monthStr = `${year}-${String(m).padStart(2, '0')}`;

    // INCOME: rental income from paid invoices
    const rentalIncome = db.prepare(`
      SELECT COALESCE(SUM(rent_amount + COALESCE(mailbox_fee,0) + COALESCE(misc_fee,0) + COALESCE(late_fee,0) + COALESCE(extra_occupancy_fee,0)),0) as t
      FROM invoices WHERE COALESCE(deleted,0)=0 AND invoice_date LIKE ?
    `).get(monthStr + '%').t;

    // Electric income (pass-through from invoices)
    const electricIncome = db.prepare(`
      SELECT COALESCE(SUM(electric_amount),0) as t FROM invoices WHERE COALESCE(deleted,0)=0 AND invoice_date LIKE ?
    `).get(monthStr + '%').t;

    // Refunds
    const refunds = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(refund_amount,0)),0) as t FROM invoices WHERE COALESCE(deleted,0)=0 AND invoice_date LIKE ?
    `).get(monthStr + '%').t;

    // EXPENSES by category
    const expensesByCategory = db.prepare(`
      SELECT category, COALESCE(SUM(amount),0) as total FROM expenses
      WHERE expense_date LIKE ? GROUP BY category
    `).all(monthStr + '%');

    const expenseMap = {};
    expensesByCategory.forEach(e => { expenseMap[e.category] = e.total; });

    // Employee payments
    const employees = db.prepare(`
      SELECT employee_name, COALESCE(SUM(amount),0) as total FROM employee_payments
      WHERE month = ? AND year = ? AND role = 'employee' GROUP BY employee_name
    `).all(m, year);

    // Owner/partner payments
    const owners = db.prepare(`
      SELECT employee_name, COALESCE(SUM(amount),0) as total FROM employee_payments
      WHERE month = ? AND year = ? AND role IN ('owner','partner') GROUP BY employee_name
    `).all(m, year);

    const employeeTotal = employees.reduce((s, e) => s + e.total, 0);
    const ownerTotal = owners.reduce((s, e) => s + e.total, 0);
    const expenseTotal = expensesByCategory.reduce((s, e) => s + e.total, 0);

    months.push({
      month: m,
      monthStr,
      rentalIncome,
      electricIncome,
      refunds,
      totalIncome: rentalIncome + electricIncome - refunds,
      employees,
      employeeTotal,
      owners,
      ownerTotal,
      expenses: expenseMap,
      expenseTotal,
      netProfit: (rentalIncome + electricIncome - refunds) - employeeTotal - ownerTotal - expenseTotal,
    });
  }

  // Get all expense categories for rows
  const categories = db.prepare('SELECT name, sort_order FROM expense_categories WHERE is_active = 1 ORDER BY sort_order').all();

  // Get all unique employee/owner names for the year
  const allEmployees = db.prepare("SELECT DISTINCT employee_name FROM employee_payments WHERE year = ? AND role = 'employee'").all(year);
  const allOwners = db.prepare("SELECT DISTINCT employee_name FROM employee_payments WHERE year = ? AND role IN ('owner','partner')").all(year);

  res.json({ year, months, categories, allEmployees, allOwners });
});

// Drill-down: get individual transactions for a category/month
router.get('/detail', (req, res) => {
  const { year, month, category, type } = req.query;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  if (type === 'income') {
    const invoices = db.prepare(`
      SELECT invoice_number, lot_id, rent_amount, electric_amount, COALESCE(mailbox_fee,0) as mailbox_fee,
        COALESCE(misc_fee,0) as misc_fee, COALESCE(late_fee,0) as late_fee, total_amount, status
      FROM invoices WHERE COALESCE(deleted,0)=0 AND invoice_date LIKE ? ORDER BY invoice_number
    `).all(monthStr + '%');
    return res.json({ type: 'income', items: invoices });
  }

  if (type === 'employee' || type === 'owner') {
    const role = type === 'employee' ? 'employee' : "('owner','partner')";
    const payments = db.prepare(`
      SELECT * FROM employee_payments WHERE month = ? AND year = ? AND role ${type === 'employee' ? "= 'employee'" : "IN ('owner','partner')"}
      ORDER BY employee_name
    `).all(month, year);
    return res.json({ type, items: payments });
  }

  // Expense category
  const expenses = db.prepare(`
    SELECT e.*, v.name as vendor_name FROM expenses e LEFT JOIN vendors v ON e.vendor_id = v.id
    WHERE e.expense_date LIKE ? AND e.category = ? ORDER BY e.expense_date
  `).all(monthStr + '%', category);
  res.json({ type: 'expense', category, items: expenses });
});

// CSV export of full P&L
router.get('/export/csv', (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  // Fetch the same data as the main endpoint
  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const header = ['CATEGORY', ...monthNames, 'YTD TOTAL'];
  const lines = [header.join(',')];

  const addRow = (label, values) => {
    const ytd = values.reduce((s, v) => s + v, 0);
    lines.push(['"' + label + '"', ...values.map(v => v.toFixed(2)), ytd.toFixed(2)].join(','));
  };

  // Get monthly data
  const monthlyIncome = [], monthlyRefunds = [], monthlyElectric = [];
  const categoryTotals = {};
  const monthlyEmpTotal = [], monthlyOwnTotal = [];

  for (let m = 1; m <= 12; m++) {
    const ms = `${year}-${String(m).padStart(2, '0')}`;
    monthlyIncome.push(db.prepare("SELECT COALESCE(SUM(rent_amount + COALESCE(mailbox_fee,0) + COALESCE(misc_fee,0) + COALESCE(late_fee,0) + COALESCE(extra_occupancy_fee,0)),0) as t FROM invoices WHERE COALESCE(deleted,0)=0 AND invoice_date LIKE ?").get(ms+'%').t);
    monthlyElectric.push(db.prepare("SELECT COALESCE(SUM(electric_amount),0) as t FROM invoices WHERE COALESCE(deleted,0)=0 AND invoice_date LIKE ?").get(ms+'%').t);
    monthlyRefunds.push(db.prepare("SELECT COALESCE(SUM(COALESCE(refund_amount,0)),0) as t FROM invoices WHERE COALESCE(deleted,0)=0 AND invoice_date LIKE ?").get(ms+'%').t);

    const exps = db.prepare("SELECT category, COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date LIKE ? GROUP BY category").all(ms+'%');
    exps.forEach(e => {
      if (!categoryTotals[e.category]) categoryTotals[e.category] = new Array(12).fill(0);
      categoryTotals[e.category][m-1] = e.total;
    });

    monthlyEmpTotal.push(db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM employee_payments WHERE month=? AND year=? AND role='employee'").get(m, year).t);
    monthlyOwnTotal.push(db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM employee_payments WHERE month=? AND year=? AND role IN ('owner','partner')").get(m, year).t);
  }

  lines.push('');
  lines.push('"INCOME"');
  addRow('RENTAL INCOME', monthlyIncome);
  addRow('ELECTRIC INCOME', monthlyElectric);
  addRow('REFUNDS', monthlyRefunds);
  const totalIncome = monthlyIncome.map((v, i) => v + monthlyElectric[i] - monthlyRefunds[i]);
  addRow('TOTAL INCOME', totalIncome);

  lines.push('');
  lines.push('"EMPLOYEES"');
  addRow('TOTAL EMPLOYEES', monthlyEmpTotal);
  lines.push('"OWNERS/PARTNERS"');
  addRow('TOTAL OWNERS/PARTNERS', monthlyOwnTotal);

  lines.push('');
  lines.push('"EXPENSES"');
  const categories = db.prepare('SELECT name FROM expense_categories WHERE is_active=1 ORDER BY sort_order').all();
  const monthlyExpTotal = new Array(12).fill(0);
  categories.forEach(c => {
    const vals = categoryTotals[c.name] || new Array(12).fill(0);
    if (vals.some(v => v > 0)) {
      addRow(c.name, vals);
      vals.forEach((v, i) => monthlyExpTotal[i] += v);
    }
  });
  addRow('TOTAL EXPENSES', monthlyExpTotal);

  lines.push('');
  const netProfit = totalIncome.map((v, i) => v - monthlyEmpTotal[i] - monthlyOwnTotal[i] - monthlyExpTotal[i]);
  addRow('NET PROFIT/LOSS', netProfit);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="PnL-${year}.csv"`);
  res.send(lines.join('\n') + '\n');
});

module.exports = router;
