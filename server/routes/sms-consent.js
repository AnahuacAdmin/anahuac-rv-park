/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * SMS Consent Form — Required for Twilio A2P 10DLC approval
 */
const express = require('express');
const router = express.Router();
const { db, saveDb } = require('../database');
const { sendSms, normalizePhone } = require('../twilio');

// ============================================
// DATABASE MIGRATION — sms_consents table
// ============================================
function ensureTable() {
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sms_consents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        email TEXT,
        consent_given INTEGER DEFAULT 1,
        consent_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        consent_version TEXT DEFAULT '1.0',
        opted_out_at TIMESTAMP,
        source TEXT DEFAULT 'digital_form'
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sms_consents_phone ON sms_consents(phone_number)`).run();
    saveDb();
  } catch (e) {
    // Table likely already exists
  }
}

// Run migration on load
setTimeout(ensureTable, 2000); // delay so DB is ready

// ============================================
// PUBLIC: Record SMS consent
// ============================================
router.post('/sms-consent', async (req, res) => {
  try {
    // Ensure table exists
    ensureTable();

    const { fullName, phone, email, consent } = req.body;

    if (!fullName || !phone || !consent) {
      return res.status(400).json({ error: 'Full name, phone number, and consent checkbox are required.' });
    }

    if (String(fullName).trim().length < 2) {
      return res.status(400).json({ error: 'Please enter your full name.' });
    }

    // Normalize phone
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit US phone number.' });
    }
    const formattedPhone = normalizePhone(phone);
    if (!formattedPhone) {
      return res.status(400).json({ error: 'Invalid phone number format.' });
    }

    // Optional email validation
    const emailVal = email ? String(email).trim() : null;
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    // Check for duplicate consent (same phone in last 24h)
    const existing = db.prepare(
      `SELECT id FROM sms_consents WHERE phone_number = ? AND consent_timestamp > datetime('now', '-1 day')`
    ).get(formattedPhone);
    if (existing) {
      return res.status(409).json({ error: 'Consent already recorded for this phone number. Thank you!' });
    }

    // Get IP address
    const ip = req.headers['x-forwarded-for']
      ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
      : req.connection?.remoteAddress || req.ip || 'unknown';

    // Record consent
    const result = db.prepare(`
      INSERT INTO sms_consents (full_name, phone_number, email, consent_given, ip_address, user_agent, source)
      VALUES (?, ?, ?, 1, ?, ?, 'digital_form')
    `).run(
      String(fullName).trim().substring(0, 200),
      formattedPhone,
      emailVal ? emailVal.substring(0, 300) : null,
      ip.substring(0, 45),
      (req.headers['user-agent'] || 'unknown').substring(0, 500)
    );
    saveDb();

    const referenceId = `RV-${String(result.lastInsertRowid).padStart(6, '0')}`;
    console.log(`[sms-consent] recorded consent: ${fullName} / ${formattedPhone} / ref=${referenceId}`);

    // Send confirmation SMS
    try {
      await sendSms(
        formattedPhone,
        'Anahuac RV Park: You are now opted-in to receive payment reminders and park notifications. Msg frequency varies (approx 2-4/mo). Msg & data rates may apply. Reply HELP for help. Reply STOP to opt out.'
      );
      console.log(`[sms-consent] confirmation SMS sent to ${formattedPhone}`);
    } catch (smsErr) {
      // Don't fail the consent recording — they consented, SMS delivery is secondary
      console.error('[sms-consent] confirmation SMS failed:', smsErr.message);
    }

    res.json({
      success: true,
      referenceId,
      message: 'Consent recorded successfully'
    });
  } catch (err) {
    console.error('[sms-consent] error:', err);
    res.status(500).json({ error: 'Failed to record consent. Please try again.' });
  }
});

// ============================================
// PUBLIC: Opt-out via web (supplement to STOP keyword)
// ============================================
router.post('/sms-consent/opt-out', (req, res) => {
  try {
    ensureTable();
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required.' });

    const formattedPhone = normalizePhone(phone);
    if (!formattedPhone) return res.status(400).json({ error: 'Invalid phone number.' });

    const existing = db.prepare(
      `SELECT id FROM sms_consents WHERE phone_number = ? AND opted_out_at IS NULL ORDER BY id DESC LIMIT 1`
    ).get(formattedPhone);

    if (!existing) {
      return res.status(404).json({ error: 'No active consent found for this number.' });
    }

    db.prepare(
      `UPDATE sms_consents SET opted_out_at = CURRENT_TIMESTAMP, consent_given = 0 WHERE phone_number = ? AND opted_out_at IS NULL`
    ).run(formattedPhone);
    saveDb();

    console.log(`[sms-consent] opt-out recorded: ${formattedPhone}`);
    res.json({ success: true, message: 'You have been opted out of SMS messages.' });
  } catch (err) {
    console.error('[sms-consent] opt-out error:', err);
    res.status(500).json({ error: 'Failed to process opt-out.' });
  }
});

// ============================================
// ADMIN: View all consents
// ============================================
router.get('/sms-consents', (req, res) => {
  // Check admin auth (same cookie pattern as other admin routes)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  try {
    ensureTable();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let where = '1=1';
    const params = [];
    if (search) {
      where = '(phone_number LIKE ? OR full_name LIKE ? OR email LIKE ?)';
      const term = `%${search.substring(0, 50)}%`;
      params.push(term, term, term);
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM sms_consents WHERE ${where}`).get(...params);
    const consents = db.prepare(
      `SELECT * FROM sms_consents WHERE ${where} ORDER BY consent_timestamp DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN consent_given = 1 AND opted_out_at IS NULL THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN opted_out_at IS NOT NULL THEN 1 ELSE 0 END) as opted_out
      FROM sms_consents
    `).get();

    res.json({
      consents,
      total: total?.c || 0,
      page,
      pages: Math.ceil((total?.c || 0) / limit),
      stats: stats || { total: 0, active: 0, opted_out: 0 }
    });
  } catch (err) {
    console.error('[sms-consent] admin list error:', err);
    res.status(500).json({ error: 'Failed to fetch consents' });
  }
});

// ADMIN: Export consents as CSV
router.get('/sms-consents/csv', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  try {
    ensureTable();
    const consents = db.prepare('SELECT * FROM sms_consents ORDER BY consent_timestamp DESC').all();
    let csv = 'ID,Full Name,Phone,Email,Consent Given,Timestamp,IP,Source,Opted Out At\n';
    consents.forEach(c => {
      csv += `${c.id},"${(c.full_name || '').replace(/"/g, '""')}","${c.phone_number}","${c.email || ''}",${c.consent_given},"${c.consent_timestamp}","${c.ip_address || ''}","${c.source || ''}","${c.opted_out_at || ''}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sms-consents-export.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
