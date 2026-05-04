/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
// Stripe webhook handler. Mounted in server/index.js BEFORE express.json so it
// receives the raw request body needed for signature verification.

const express = require('express');
const { db } = require('./database');
const { sendSms } = require('./twilio');
const pushService = require('./services/push-notifications');
let _resend = null;
function getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  const { Resend } = require('resend');
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const FROM_ADDRESS = 'Anahuac RV Park <invoices@anrvpark.com>';
const APP_URL = process.env.APP_URL || 'https://web-production-89794.up.railway.app';

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
  _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2022-11-15',
  });
  return _stripe;
}

function registerStripeWebhook(app) {
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (req, res) => {
      const sig = req.headers['stripe-signature'];
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) { console.error('[stripe] STRIPE_WEBHOOK_SECRET not set'); return res.status(500).send('Webhook not configured'); }

      let event;
      try {
        const stripe = getStripe();
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
      } catch (err) {
        console.error('[stripe] webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      try {
        // Handle saved-card payments via PaymentIntent
        if (event.type === 'payment_intent.succeeded') {
          const pi = event.data.object;
          const invoiceId = parseInt(pi.metadata?.invoice_id);
          const tenantId = parseInt(pi.metadata?.tenant_id);
          const balanceAmount = parseFloat(pi.metadata?.balance_amount);
          if (!invoiceId || !tenantId || isNaN(balanceAmount)) {
            return res.json({ received: true, ignored: 'missing metadata' });
          }
          // Idempotency check
          const already = db.prepare("SELECT id FROM payments WHERE reference_number = ? LIMIT 1").get(pi.id);
          if (already) return res.json({ received: true, ignored: 'already recorded' });

          const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
          if (!inv) return res.json({ received: true, ignored: 'invoice not found' });

          const today = new Date().toISOString().split('T')[0];
          db.prepare(`INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes)
            VALUES (?, ?, ?, ?, 'Credit Card', ?, ?)`)
            .run(tenantId, inv.id, today, balanceAmount, pi.id,
              `Stripe saved card, charged $${(pi.amount / 100).toFixed(2)} (incl. 3% convenience fee)`);

          const newPaid = (Number(inv.amount_paid) || 0) + balanceAmount;
          const newBalance = (Number(inv.total_amount) || 0) - newPaid;
          const newStatus = newBalance <= 0.005 ? 'paid' : 'partial';
          db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
            .run(newPaid, Math.max(0, newBalance), newStatus, inv.id);

          if (newBalance <= 0.005) {
            const unpaid = db.prepare("SELECT COUNT(*) as cnt FROM invoices WHERE tenant_id = ? AND balance_due > 0.005 AND status IN ('pending','partial') AND COALESCE(deleted,0) = 0").get(tenantId);
            if (!unpaid || unpaid.cnt === 0) {
              db.prepare('UPDATE tenants SET eviction_warning = 0, eviction_notified = 0, eviction_paused = 0, eviction_pause_note = NULL WHERE id = ?').run(tenantId);
            }
          }

          console.log(`[stripe] saved-card payment recorded for invoice ${inv.invoice_number}`);

          // Push notifications
          try {
            pushService.notifyTenant(tenantId, { type: 'payment', title: '\u2705 Payment Received \u2014 Thank You!', body: '$' + balanceAmount.toFixed(2) + ' paid via credit card. Receipt available.', url: '/portal', priority: 'normal' });
            var _tn = db.prepare('SELECT first_name, last_name, lot_id FROM tenants WHERE id = ?').get(tenantId);
            pushService.notifyAdmin({ type: 'payment', title: '\ud83d\udcb3 Payment from ' + (_tn?.first_name || 'Tenant'), body: '$' + balanceAmount.toFixed(2) + ' received from ' + (_tn ? _tn.first_name + ' ' + _tn.last_name : 'Unknown') + ' (Lot ' + (_tn?.lot_id || '?') + ')', url: '/', priority: 'normal' });
          } catch {}

          // Send confirmations (non-blocking)
          const tenant = db.prepare('SELECT first_name, last_name, email, phone, lot_id FROM tenants WHERE id = ?').get(tenantId);
          const remainingBalance = Math.max(0, newBalance).toFixed(2);
          if (tenant) {
            try {
              const resend = getResend();
              if (resend && tenant.email) {
                resend.emails.send({
                  from: FROM_ADDRESS, to: tenant.email,
                  subject: 'Payment Received — Anahuac RV Park',
                  text: `Thank you, ${tenant.first_name}!\n\nYour payment of $${balanceAmount.toFixed(2)} for Invoice ${inv.invoice_number} has been received on ${today}.\n\nRemaining balance: $${remainingBalance}\n\nIf you have questions, call us at 409-267-6603 or visit ${APP_URL}/portal.html\n\nAnahuac RV Park\n1003 Davis Ave, Anahuac, TX 77514\n409-267-6603`,
                }).catch(e => console.error('[stripe] confirmation email failed:', e.message));
              }
            } catch (e) {}
            try {
              if (tenant.phone) {
                sendSms(tenant.phone, `Anahuac RV Park: Payment of $${balanceAmount.toFixed(2)} received for Invoice ${inv.invoice_number}. Thank you! Balance: $${remainingBalance}. Questions? 409-267-6603`).catch(() => {});
              }
            } catch (e) {}
          }
          return res.json({ received: true });
        }

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const invoiceId = parseInt(session.metadata?.invoice_id);
          if (!invoiceId) {
            console.warn('[stripe] webhook session has no invoice_id metadata');
            return res.json({ received: true, ignored: 'no invoice_id' });
          }
          const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
          if (!inv) {
            console.warn('[stripe] invoice', invoiceId, 'not found for session', session.id);
            return res.json({ received: true, ignored: 'invoice not found' });
          }

          // Idempotency: don't double-record if we've already logged this session.
          const already = db.prepare(
            "SELECT id FROM payments WHERE reference_number = ? LIMIT 1"
          ).get(session.id);
          if (already) {
            return res.json({ received: true, ignored: 'already recorded' });
          }

          // Stripe amounts are in cents. The customer was charged total + 3% fee,
          // but the invoice is satisfied by `balance_due` (the pre-fee amount).
          // Record the payment as the invoice balance owed.
          const today = new Date().toISOString().split('T')[0];
          const paymentAmount = Number(inv.balance_due) || 0;

          db.prepare(`
            INSERT INTO payments (tenant_id, invoice_id, payment_date, amount, payment_method, reference_number, notes)
            VALUES (?, ?, ?, ?, 'Credit Card', ?, ?)
          `).run(
            inv.tenant_id, inv.id, today, paymentAmount,
            session.id,
            `Stripe payment, customer charged $${(session.amount_total / 100).toFixed(2)} (incl. 3% convenience fee)`
          );

          const newPaid = (Number(inv.amount_paid) || 0) + paymentAmount;
          const newBalance = (Number(inv.total_amount) || 0) - newPaid;
          const newStatus = newBalance <= 0.005 ? 'paid' : 'partial';
          db.prepare('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?')
            .run(newPaid, Math.max(0, newBalance), newStatus, inv.id);

          // Clear eviction warning if tenant has no remaining unpaid invoices.
          if (newBalance <= 0.005) {
            const unpaid = db.prepare(
              "SELECT COUNT(*) as cnt FROM invoices WHERE tenant_id = ? AND balance_due > 0.005 AND status IN ('pending','partial') AND COALESCE(deleted,0) = 0"
            ).get(inv.tenant_id);
            if (!unpaid || unpaid.cnt === 0) {
              db.prepare('UPDATE tenants SET eviction_warning = 0, eviction_notified = 0, eviction_paused = 0, eviction_pause_note = NULL WHERE id = ?').run(inv.tenant_id);
            }
          }

          console.log(`[stripe] payment recorded for invoice ${inv.invoice_number}`);

          // Push notifications
          try {
            pushService.notifyTenant(inv.tenant_id, { type: 'payment', title: '\u2705 Payment Received \u2014 Thank You!', body: '$' + paymentAmount.toFixed(2) + ' paid via credit card. Receipt available.', url: '/portal', priority: 'normal' });
            var _tn2 = db.prepare('SELECT first_name, last_name, lot_id FROM tenants WHERE id = ?').get(inv.tenant_id);
            pushService.notifyAdmin({ type: 'payment', title: '\ud83d\udcb3 Payment from ' + (_tn2?.first_name || 'Tenant'), body: '$' + paymentAmount.toFixed(2) + ' received from ' + (_tn2 ? _tn2.first_name + ' ' + _tn2.last_name : 'Unknown') + ' (Lot ' + (_tn2?.lot_id || '?') + ')', url: '/', priority: 'normal' });
          } catch {}

          // Send confirmation email + SMS (non-blocking)
          const tenant = db.prepare('SELECT first_name, last_name, email, phone, lot_id FROM tenants WHERE id = ?').get(inv.tenant_id);
          const remainingBalance = Math.max(0, newBalance).toFixed(2);
          if (tenant) {
            // Email confirmation via Resend
            try {
              const resend = getResend();
              if (resend && tenant.email) {
                resend.emails.send({
                  from: FROM_ADDRESS,
                  to: tenant.email,
                  subject: `Payment Received — Anahuac RV Park`,
                  text: `Thank you, ${tenant.first_name}!\n\nYour payment of $${paymentAmount.toFixed(2)} for Invoice ${inv.invoice_number} has been received on ${today}.\n\nRemaining balance: $${remainingBalance}\n\nIf you have questions, call us at 409-267-6603 or visit ${APP_URL}/portal.html\n\nAnahuac RV Park\n1003 Davis Ave, Anahuac, TX 77514\n409-267-6603`,
                }).catch(e => console.error('[stripe] confirmation email failed:', e.message));
              }
            } catch (e) { console.error('[stripe] email setup error:', e.message); }

            // SMS confirmation via Twilio
            try {
              if (tenant.phone) {
                sendSms(tenant.phone, `Anahuac RV Park: Payment of $${paymentAmount.toFixed(2)} received for Invoice ${inv.invoice_number}. Thank you! Balance: $${remainingBalance}. Questions? 409-267-6603`).catch(e => console.error('[stripe] confirmation SMS failed:', e.message));
              }
            } catch (e) { console.error('[stripe] SMS setup error:', e.message); }
          }
        }
        res.json({ received: true });
      } catch (err) {
        console.error('[stripe] webhook handler error:', err);
        res.status(500).json({ error: 'Webhook processing error' });
      }
    }
  );
}

module.exports = { registerStripeWebhook };
