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
