/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

// List expenses with filters
router.get('/', (req, res) => {
  var q = req.query;
  var sql = 'SELECT * FROM expenses WHERE 1=1';
  var params = [];
  if (q.category && q.category !== 'all') { sql += ' AND category=?'; params.push(q.category); }
  if (q.from) { sql += ' AND expense_date>=?'; params.push(q.from); }
  if (q.to) { sql += ' AND expense_date<=?'; params.push(q.to); }
  if (q.vendor) { sql += ' AND vendor LIKE ?'; params.push('%' + q.vendor + '%'); }
  sql += ' ORDER BY expense_date DESC';
  var rows = db.prepare(sql).all(...params);
  rows.forEach(function(r) { r.has_receipt = !!r.receipt_photo; delete r.receipt_photo; });
  res.json(rows);
});

// Monthly summary
router.get('/summary', (req, res) => {
  var month = req.query.month || new Date().toISOString().slice(0, 7);
  var total = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE expense_date LIKE ?").get(month + '%').t;
  var byCategory = db.prepare("SELECT category, COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date LIKE ? GROUP BY category ORDER BY total DESC").all(month + '%');

  // Year total
  var year = month.slice(0, 4);
  var yearTotal = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE expense_date LIKE ?").get(year + '%').t;

  // Receipt count
  var receiptCount = db.prepare("SELECT COUNT(*) as c FROM expenses WHERE receipt_photo IS NOT NULL AND receipt_photo != ''").get().c;

  // Top vendor
  var topVendors = db.prepare("SELECT vendor, COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date LIKE ? AND vendor IS NOT NULL AND vendor != '' GROUP BY vendor ORDER BY total DESC LIMIT 5").all(year + '%');

  // Monthly history (last 6 months)
  var monthlyHistory = [];
  for (var i = 5; i >= 0; i--) {
    var d = new Date(); d.setMonth(d.getMonth() - i);
    var m = d.toISOString().slice(0, 7);
    var t = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE expense_date LIKE ?").get(m + '%').t;
    monthlyHistory.push({ month: m, total: t });
  }

  // Electric pass-through from invoices (auto-calculated, not a manual expense)
  var electricMonth = db.prepare("SELECT COALESCE(SUM(electric_amount),0) as t FROM invoices WHERE status IN ('paid','partial') AND COALESCE(deleted,0)=0 AND invoice_date LIKE ?").get(month + '%').t;
  var electricYear = db.prepare("SELECT COALESCE(SUM(electric_amount),0) as t FROM invoices WHERE status IN ('paid','partial') AND COALESCE(deleted,0)=0 AND invoice_date LIKE ?").get(year + '%').t;

  // Park revenue for P&L
  var revenueMonth = db.prepare("SELECT COALESCE(SUM(rent_amount + COALESCE(mailbox_fee,0) + COALESCE(misc_fee,0) + COALESCE(late_fee,0)),0) as t FROM invoices WHERE status IN ('paid','partial') AND COALESCE(deleted,0)=0 AND invoice_date LIKE ?").get(month + '%').t;
  var revenueYear = db.prepare("SELECT COALESCE(SUM(rent_amount + COALESCE(mailbox_fee,0) + COALESCE(misc_fee,0) + COALESCE(late_fee,0)),0) as t FROM invoices WHERE status IN ('paid','partial') AND COALESCE(deleted,0)=0 AND invoice_date LIKE ?").get(year + '%').t;
  var refundsMonth = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE amount < 0 AND payment_date LIKE ?").get(month + '%').t;
  var refundsYear = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE amount < 0 AND payment_date LIKE ?").get(year + '%').t;

  // Recurring expenses (monthly ones apply each month; quarterly/annually prorated)
  var recurring = db.prepare("SELECT * FROM recurring_expenses WHERE is_active = 1").all();
  var recurringMonth = 0, recurringYear = 0;
  recurring.forEach(function(r) {
    var monthly = r.frequency === 'monthly' ? r.total_amount : r.frequency === 'quarterly' ? r.total_amount / 3 : r.frequency === 'annually' ? r.total_amount / 12 : r.total_amount;
    recurringMonth += monthly;
    // Year: months elapsed so far this year
    var monthsElapsed = new Date().getMonth() + 1;
    recurringYear += monthly * monthsElapsed;
  });

  res.json({ month, total, byCategory, yearTotal, receiptCount, topVendors, monthlyHistory,
    electricMonth, electricYear, revenueMonth, revenueYear, refundsMonth, refundsYear,
    recurringMonth, recurringYear, recurringItems: recurring });
});

// Get receipt image
router.get('/:id/receipt', (req, res) => {
  var row = db.prepare('SELECT receipt_photo FROM expenses WHERE id=?').get(req.params.id);
  if (!row || !row.receipt_photo) return res.status(404).json({ error: 'No receipt' });
  var buf = Buffer.from(row.receipt_photo, 'base64');
  res.set('Content-Type', 'image/jpeg');
  res.send(buf);
});

// CSV export
router.get('/export/csv', (req, res) => {
  var q = req.query;
  var sql = 'SELECT expense_date, category, vendor, description, amount, paid_by FROM expenses WHERE 1=1';
  var params = [];
  if (q.from) { sql += ' AND expense_date>=?'; params.push(q.from); }
  if (q.to) { sql += ' AND expense_date<=?'; params.push(q.to); }
  sql += ' ORDER BY expense_date DESC';
  var rows = db.prepare(sql).all(...params);

  var csvEsc = function(v) {
    var s = String(v == null ? '' : v);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  var lines = ['Date,Category,Vendor,Description,Amount,Paid By'];
  rows.forEach(function(r) {
    lines.push([r.expense_date, r.category, r.vendor, r.description, Number(r.amount).toFixed(2), r.paid_by].map(csvEsc).join(','));
  });
  var total = rows.reduce(function(s, r) { return s + (Number(r.amount) || 0); }, 0);
  lines.push(',,,TOTAL,' + total.toFixed(2) + ',');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="expenses-' + (q.from || 'all') + '-to-' + (q.to || 'now') + '.csv"');
  res.send(lines.join('\n') + '\n');
});

// Create expense
router.post('/', (req, res) => {
  var b = req.body || {};
  if (!b.expense_date || !b.amount) return res.status(400).json({ error: 'Date and amount required' });
  var result = db.prepare('INSERT INTO expenses (expense_date, category, description, amount, receipt_photo, vendor, paid_by) VALUES (?,?,?,?,?,?,?)').run(
    b.expense_date, b.category || 'Other', b.description || '', Number(b.amount) || 0, b.receipt_photo || null, b.vendor || null, b.paid_by || null
  );
  res.json({ id: result.lastInsertRowid });
});

// Update expense
router.put('/:id', (req, res) => {
  var b = req.body || {};
  // Only update receipt_photo if explicitly provided (avoids clearing it on edit)
  if (b.receipt_photo !== undefined) {
    db.prepare('UPDATE expenses SET expense_date=?, category=?, description=?, amount=?, receipt_photo=?, vendor=?, paid_by=? WHERE id=?').run(
      b.expense_date, b.category || 'Other', b.description || '', Number(b.amount) || 0, b.receipt_photo || null, b.vendor || null, b.paid_by || null, req.params.id
    );
  } else {
    db.prepare('UPDATE expenses SET expense_date=?, category=?, description=?, amount=?, vendor=?, paid_by=? WHERE id=?').run(
      b.expense_date, b.category || 'Other', b.description || '', Number(b.amount) || 0, b.vendor || null, b.paid_by || null, req.params.id
    );
  }
  res.json({ success: true });
});

// Scan receipt via Claude API
router.post('/scan-receipt', async (req, res) => {
  var b = req.body || {};
  if (!b.image) return res.status(400).json({ error: 'image (base64) is required' });
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    var mime = b.mime || 'image/jpeg';
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: b.image } },
            { type: 'text', text: 'You are a receipt scanner. Extract the following from this receipt image and return ONLY a JSON object with no other text:\n{\n  "vendor": "store/business name",\n  "date": "date in YYYY-MM-DD format",\n  "amount": total amount as a number only,\n  "items": "brief description of what was purchased",\n  "category": "best matching category from: Electric/Utilities, Plumbing/Water, Maintenance/Repairs, Supplies/Hardware, Landscaping, Insurance, Taxes/Fees, Equipment, Labor/Contractors, Office/Admin, Other"\n}\nIf you cannot read a field, return null for that field.' }
          ]
        }]
      })
    });
    var data = await resp.json();
    if (!resp.ok) {
      console.error('[expenses] Claude API error:', data);
      return res.status(500).json({ error: 'AI scan failed: ' + (data.error?.message || 'unknown') });
    }
    var text = (data.content && data.content[0] && data.content[0].text) || '';
    // Extract JSON from response (may have markdown fences)
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse AI response' });
    var parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error('[expenses] scan-receipt error:', err.message);
    res.status(500).json({ error: 'Receipt scan failed: ' + err.message });
  }
});

// Delete expense
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// --- Recurring Expenses ---
router.get('/recurring', (req, res) => {
  res.json(db.prepare("SELECT * FROM recurring_expenses ORDER BY name").all());
});

router.post('/recurring', (req, res) => {
  var b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  var qty = Number(b.quantity) || 1;
  var unit = Number(b.amount_per_unit) || 0;
  var total = qty * unit;
  var result = db.prepare("INSERT INTO recurring_expenses (name, description, amount_per_unit, quantity, total_amount, frequency, category) VALUES (?,?,?,?,?,?,?)").run(
    b.name, b.description || '', unit, qty, total, b.frequency || 'monthly', b.category || 'Other'
  );
  res.json({ id: result.lastInsertRowid });
});

router.put('/recurring/:id', (req, res) => {
  var b = req.body || {};
  var qty = Number(b.quantity) || 1;
  var unit = Number(b.amount_per_unit) || 0;
  var total = qty * unit;
  db.prepare("UPDATE recurring_expenses SET name=?, description=?, amount_per_unit=?, quantity=?, total_amount=?, frequency=?, category=?, is_active=? WHERE id=?").run(
    b.name, b.description || '', unit, qty, total, b.frequency || 'monthly', b.category || 'Other', b.is_active !== undefined ? (b.is_active ? 1 : 0) : 1, req.params.id
  );
  res.json({ success: true });
});

router.delete('/recurring/:id', (req, res) => {
  db.prepare('DELETE FROM recurring_expenses WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
