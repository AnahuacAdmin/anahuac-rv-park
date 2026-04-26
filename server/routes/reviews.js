/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 */
const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireAdmin } = require('../middleware');

const DEFAULT_REVIEW_URL = 'https://search.google.com/local/writereview?placeid=ChIJgTxw3Pk-P4YRs2t_UMVRVa4';
const FALLBACK_REVIEW_URL = 'https://www.google.com/search?q=Anahuac+RV+Park+reviews';

function getReviewUrl() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'google_review_url'").get();
  return row?.value || DEFAULT_REVIEW_URL;
}

function getCooldownDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'review_request_cooldown_days'").get();
  return parseInt(row?.value) || 90;
}

function isEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'review_request_enabled'").get();
  return row?.value !== '0';
}

// Check if tenant was already sent a request within cooldown period
function recentlySent(tenantId) {
  const days = getCooldownDays();
  const row = db.prepare(
    "SELECT id FROM review_requests WHERE tenant_id = ? AND sent_at > datetime('now', '-' || ? || ' days')"
  ).get(tenantId, days);
  return !!row;
}

// Send review request
router.post('/send', requireAdmin, async (req, res) => {
  const { tenant_id } = req.body;
  if (!tenant_id) return res.status(400).json({ error: 'tenant_id required' });

  if (!isEnabled()) return res.status(400).json({ error: 'Review requests are disabled' });

  const tenant = db.prepare('SELECT id, first_name, last_name, phone, email, lot_id FROM tenants WHERE id = ?').get(tenant_id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  if (recentlySent(tenant_id)) {
    return res.json({ success: true, skipped: true, reason: 'Review request already sent within cooldown period' });
  }

  const reviewUrl = getReviewUrl();
  const name = tenant.first_name;
  const fullName = tenant.first_name + ' ' + tenant.last_name;
  let method = 'none';
  const errors = [];

  // Send SMS
  if (tenant.phone) {
    try {
      const { sendSms } = require('../twilio');
      const smsBody = `Hi ${name}! Thanks for staying at Anahuac RV Park 🐊 We'd love a quick Google review: ${reviewUrl} — it means the world to us! Safe travels!`;
      await sendSms(tenant.phone, smsBody);
      method = 'sms';
    } catch (err) {
      console.error('[reviews] SMS failed:', err.message);
      errors.push('SMS: ' + err.message);
    }
  }

  // Send email
  if (tenant.email) {
    try {
      const { Resend } = require('resend');
      if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Anahuac RV Park <invoices@anrvpark.com>',
        reply_to: 'anrvpark@gmail.com',
        to: tenant.email,
        subject: 'Thanks for staying at Anahuac RV Park!',
        text: `Hi ${name},\n\nThank you for staying with us at Anahuac RV Park! We hope you enjoyed your time in the Gator Country 🐊\n\nIf you had a great experience, we'd really appreciate a quick Google review — it helps other travelers find us!\n\nLeave a review here: ${reviewUrl}\n\nIt only takes a minute and means the world to us.\n\nSafe travels and come back anytime!\n\nJimmy & the Anahuac RV Park family\n1003 Davis Ave, Anahuac, TX 77514\n409-267-6603`,
      });
      method = method === 'sms' ? 'both' : 'email';
    } catch (err) {
      console.error('[reviews] Email failed:', err.message);
      errors.push('Email: ' + err.message);
    }
  }

  if (method === 'none') {
    return res.status(400).json({ error: 'No contact info available. ' + errors.join('; ') });
  }

  // Log the request
  db.prepare(
    'INSERT INTO review_requests (tenant_id, tenant_name, lot_number, method, status) VALUES (?, ?, ?, ?, ?)'
  ).run(tenant_id, fullName, tenant.lot_id, method, 'sent');

  res.json({ success: true, method, errors: errors.length ? errors : undefined });
});

// Check if tenant can receive review request (for UI)
router.get('/can-send/:tenantId', requireAdmin, (req, res) => {
  const tenantId = parseInt(req.params.tenantId);
  const enabled = isEnabled();
  const alreadySent = recentlySent(tenantId);
  res.json({ canSend: enabled && !alreadySent, enabled, alreadySent });
});

// List all review requests
router.get('/', requireAdmin, (req, res) => {
  const requests = db.prepare(
    'SELECT * FROM review_requests ORDER BY sent_at DESC LIMIT 100'
  ).all();

  const thisMonth = db.prepare(
    "SELECT COUNT(*) as c FROM review_requests WHERE sent_at > date('now','start of month')"
  ).get().c;

  res.json({ requests, thisMonth });
});

module.exports = router;
