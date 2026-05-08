/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
// Public booking API — no auth middleware. Guests use this to reserve transient lots.

const router = require('express').Router();
const { db, saveDb } = require('../database');

// ── Stripe (lazy) ────────────────────────────────────────────────────────────
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Payment system not configured');
  return require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2022-11-15' });
}

// ── Resend (lazy) ────────────────────────────────────────────────────────────
let _resend = null;
function getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  const { Resend } = require('resend');
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const FROM_ADDRESS = 'Anahuac RV Park <invoices@anrvpark.com>';

// ── SMS (lazy import) ────────────────────────────────────────────────────────
function trySendSms(to, body) {
  try {
    const { sendSms } = require('../twilio');
    return sendSms(to, body);
  } catch (err) {
    console.error('[booking] SMS send failed:', err.message);
    return null;
  }
}

// ── Data integrity guardrail ─────────────────────────────────────────────────
let startupReservationCount = null;
function captureStartupCount() {
  try {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM reservations').get();
    startupReservationCount = row.cnt;
    console.log(`[booking] startup reservation count snapshot: ${startupReservationCount}`);
  } catch (err) {
    console.error('[booking] could not capture startup count:', err.message);
  }
}
// Capture on first request (db may not be ready at require-time)
let captured = false;

// ── Pricing ──────────────────────────────────────────────────────────────────
function computeRates(lot) {
  let nightly, weekly;
  if (lot.base_nightly_rate > 0) {
    nightly = lot.base_nightly_rate;
    weekly = lot.base_weekly_rate > 0 ? lot.base_weekly_rate : nightly * 7;
  } else if (lot.cement_pad) {
    nightly = 35;
    weekly = 165;
  } else {
    nightly = 30;
    weekly = 150;
  }
  return { nightly, weekly };
}

function computeTotal(nightly, weekly, nights) {
  if (nights >= 7) {
    const fullWeeks = Math.floor(nights / 7);
    const remaining = nights % 7;
    return +(fullWeeks * weekly + remaining * nightly).toFixed(2);
  }
  return +(nights * nightly).toFixed(2);
}

// ── Availability ─────────────────────────────────────────────────────────────
function isLotAvailable(lotId, arrival, departure) {
  const conflict = db.prepare(`
    SELECT id FROM reservations
    WHERE lot_id = ? AND status NOT IN ('cancelled', 'checked-out')
      AND arrival_date < ? AND departure_date > ?
  `).get(lotId, departure, arrival);
  return !conflict;
}

// ── Confirmation number: RES-YYYY-NNNN ───────────────────────────────────────
function nextReservationNumber() {
  const year = new Date().getFullYear();
  const prefix = `RES-${year}-`;
  const last = db.prepare(
    "SELECT confirmation_number FROM reservations WHERE confirmation_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(prefix + '%');
  let num = 0;
  if (last && last.confirmation_number) {
    const match = last.confirmation_number.match(/^RES-\d{4}-(\d+)$/);
    if (match) num = parseInt(match[1]) || 0;
  }
  return prefix + String(num + 1).padStart(4, '0');
}

// ── Phone cleanup ────────────────────────────────────────────────────────────
function cleanPhone(v) {
  if (v === undefined || v === null || v === '') return null;
  const digits = String(v).replace(/\D/g, '');
  return digits || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/booking/stripe-key — return publishable key
router.get('/stripe-key', (req, res) => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) return res.status(500).json({ error: 'Payment system not configured' });
  res.json({ publishableKey: key });
});

// GET /api/booking/available-lots?arrival=YYYY-MM-DD&departure=YYYY-MM-DD
router.get('/available-lots', (req, res) => {
  try {
    const { arrival, departure } = req.query;
    if (!arrival || !departure) return res.status(400).json({ error: 'arrival and departure required' });

    const arrDate = new Date(arrival);
    const depDate = new Date(departure);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    if (isNaN(arrDate) || isNaN(depDate)) return res.status(400).json({ error: 'Invalid date format' });
    if (arrDate < today) return res.status(400).json({ error: 'Arrival date cannot be in the past' });
    if (depDate <= arrDate) return res.status(400).json({ error: 'Departure must be after arrival' });

    const nights = Math.round((depDate - arrDate) / 86400000);
    if (nights > 30) return res.status(400).json({ error: 'Maximum stay is 30 nights' });

    const lots = db.prepare(`
      SELECT id, site_type, cement_pad, base_nightly_rate, base_weekly_rate, current_status
      FROM lots
      WHERE default_transient = 1
        AND current_status IN ('transient_available', 'transient_booked')
    `).all();

    const available = lots.filter(lot => {
      if (lot.current_status === 'transient_booked') {
        return isLotAvailable(lot.id, arrival, departure);
      }
      return true;
    }).map(lot => {
      const { nightly, weekly } = computeRates(lot);
      const total = computeTotal(nightly, weekly, nights);
      const rateType = nights >= 7 ? 'weekly' : 'nightly';
      return {
        id: lot.id,
        site_type: lot.site_type,
        surface: lot.cement_pad ? 'Cement' : 'Grass',
        nightly_rate: nightly,
        weekly_rate: weekly,
        rate_type: rateType,
        total,
        nights,
      };
    });

    res.json({ lots: available, nights, arrival, departure });
  } catch (err) {
    console.error('[booking] available-lots error:', err);
    res.status(500).json({ error: 'Could not check availability' });
  }
});

// POST /api/booking/setup-intent — create Stripe Customer + SetupIntent
router.post('/setup-intent', async (req, res) => {
  try {
    const { name, email, phone } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

    const stripe = getStripe();
    const customer = await stripe.customers.create({
      name,
      email,
      phone: phone || undefined,
      metadata: { source: 'public_booking' },
    });
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
    });
    res.json({
      client_secret: setupIntent.client_secret,
      customer_id: customer.id,
      setup_intent_id: setupIntent.id,
    });
  } catch (err) {
    console.error('[booking] setup-intent error:', err);
    res.status(500).json({ error: 'Could not start card setup' });
  }
});

// POST /api/booking/confirm — validate, create reservation, notify admin
router.post('/confirm', async (req, res) => {
  try {
    // Lazy capture startup count
    if (!captured) { captureStartupCount(); captured = true; }

    const b = req.body || {};

    // Validate required fields
    const required = ['lot_id', 'arrival_date', 'departure_date', 'guest_name', 'phone', 'email',
      'stripe_customer_id', 'stripe_payment_method_id', 'stripe_setup_intent_id'];
    for (const field of required) {
      if (!b[field]) return res.status(400).json({ error: `${field} is required` });
    }

    // Data integrity guardrail
    if (startupReservationCount !== null) {
      const current = db.prepare('SELECT COUNT(*) as cnt FROM reservations').get().cnt;
      if (current < startupReservationCount) {
        console.error(`[CRITICAL] Reservation count dropped! startup=${startupReservationCount} current=${current}`);
      }
    }

    // Re-check availability (race condition prevention)
    if (!isLotAvailable(b.lot_id, b.arrival_date, b.departure_date)) {
      return res.status(409).json({ error: `Lot ${b.lot_id} is no longer available for those dates` });
    }

    // Verify lot is transient
    const lot = db.prepare('SELECT * FROM lots WHERE id = ? AND default_transient = 1').get(b.lot_id);
    if (!lot) return res.status(400).json({ error: 'Invalid lot selection' });

    // Server-side pricing (never trust client)
    const { nightly, weekly } = computeRates(lot);
    const nights = Math.max(1, Math.round(
      (new Date(b.departure_date) - new Date(b.arrival_date)) / 86400000
    ));
    const total = computeTotal(nightly, weekly, nights);
    const rateType = nights >= 7 ? 'weekly' : 'nightly';
    const confNum = nextReservationNumber();
    const now = new Date().toISOString();

    // INSERT reservation — old columns + new Phase 1 columns
    const result = db.prepare(`
      INSERT INTO reservations
        (guest_name, phone, email, lot_id, arrival_date, departure_date, nights,
         rate_per_night, total_amount, deposit_paid, status, confirmation_number,
         rv_type_length, rate_type, total_quoted, source, source_other,
         policy_acknowledged_at, stripe_customer_id, stripe_payment_method_id,
         stripe_setup_intent_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.guest_name, cleanPhone(b.phone), b.email, b.lot_id,
      b.arrival_date, b.departure_date, nights,
      nightly, total, 0, 'confirmed', confNum,
      b.rv_type_length || null, rateType, total, b.source || 'website', b.source_other || null,
      b.policy_acknowledged_at || now, b.stripe_customer_id, b.stripe_payment_method_id,
      b.stripe_setup_intent_id, now
    );

    // UPDATE lot status → transient_booked
    const prevStatus = lot.current_status;
    db.prepare('UPDATE lots SET current_status = ?, status = ? WHERE id = ?')
      .run('transient_booked', 'occupied', b.lot_id);

    // Audit: lot_status_history
    db.prepare(`
      INSERT INTO lot_status_history (lot_id, previous_status, new_status, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(b.lot_id, prevStatus, 'transient_booked', `Public booking ${confNum}`, now);

    // Audit: reservation_events
    db.prepare(`
      INSERT INTO reservation_events (reservation_id, event_type, actor, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(result.lastInsertRowid, 'created', 'guest', JSON.stringify({
      source: 'public_booking', ip: req.ip,
    }), now);

    saveDb();

    // ── Admin notifications (fire-and-forget) ──────────────────────────────
    const notifBody = [
      `New Booking: ${b.guest_name}`,
      `Lot: ${b.lot_id}`,
      `Dates: ${b.arrival_date} → ${b.departure_date} (${nights} nights)`,
      `Total: $${total.toFixed(2)}`,
      `Phone: ${b.phone}`,
      `Email: ${b.email}`,
      `Confirmation: ${confNum}`,
    ].join('\n');

    // Email via Resend (works today)
    const resend = getResend();
    if (resend) {
      resend.emails.send({
        from: FROM_ADDRESS,
        to: 'anrvpark@gmail.com',
        subject: `New Booking: ${b.guest_name} - Lot ${b.lot_id} - ${b.arrival_date}`,
        text: notifBody,
      }).catch(err => console.error('[booking] admin email failed:', err.message));
    } else {
      console.log('[booking] Resend not configured — admin notification email:\n' + notifBody);
    }

    // SMS (feature-flagged — OFF by default until Twilio A2P approved)
    try {
      const smsEnabled = db.prepare("SELECT value FROM settings WHERE key = 'booking_sms_enabled'").get();
      const phonesRow = db.prepare("SELECT value FROM settings WHERE key = 'booking_notification_phones'").get();
      if (smsEnabled && smsEnabled.value === '1' && phonesRow && phonesRow.value) {
        const phones = phonesRow.value.split(',').map(p => p.trim()).filter(Boolean);
        const smsBody = `New RV Park Booking!\n${b.guest_name} - Lot ${b.lot_id}\n${b.arrival_date} to ${b.departure_date}\n$${total.toFixed(2)} | ${confNum}`;
        for (const phone of phones) {
          trySendSms(phone, smsBody);
        }
      }
    } catch (err) {
      console.error('[booking] SMS notification error:', err.message);
    }

    console.log(`[booking] reservation created: ${confNum} lot=${b.lot_id} ${b.arrival_date}→${b.departure_date}`);

    res.json({
      confirmation_number: confNum,
      lot_id: b.lot_id,
      arrival_date: b.arrival_date,
      departure_date: b.departure_date,
      nights,
      nightly_rate: nightly,
      weekly_rate: weekly,
      rate_type: rateType,
      total,
      guest_name: b.guest_name,
    });
  } catch (err) {
    console.error('[booking] confirm error:', err);
    res.status(500).json({ error: 'Could not complete reservation. Please call 409-267-6603.' });
  }
});

module.exports = router;
