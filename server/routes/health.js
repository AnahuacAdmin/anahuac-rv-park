/*
 * Anahuac RV Park Management System
 * Copyright © 2026 Anahuac RV Park LLC. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying, distribution, or use is strictly prohibited.
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

async function checkService(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    return { name, status: result.status || 'ok', message: result.message || 'Connected', responseTime: Date.now() - start, checkedAt: new Date().toISOString(), ...result.extra };
  } catch (err) {
    return { name, status: 'error', message: err.message || 'Unknown error', responseTime: Date.now() - start, checkedAt: new Date().toISOString() };
  }
}

router.get('/status', async (req, res) => {
  const checks = await Promise.all([

    // Database
    checkService('Database', async () => {
      const r = db.prepare('SELECT 1 as ok').get();
      if (!r?.ok) throw new Error('Query failed');
      const count = db.prepare('SELECT COUNT(*) as c FROM tenants').get().c;
      return { message: `Connected (${count} tenants)` };
    }),

    // Stripe
    checkService('Stripe', async () => {
      if (!process.env.STRIPE_SECRET_KEY) return { status: 'error', message: 'STRIPE_SECRET_KEY not set' };
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const account = await stripe.accounts.retrieve();
      const isTest = process.env.STRIPE_SECRET_KEY.startsWith('sk_test');
      if (isTest) return { status: 'warning', message: 'TEST mode active — real payments won\'t process', extra: { mode: 'test' } };
      return { message: `Live mode — ${account.business_profile?.name || account.id}`, extra: { mode: 'live' } };
    }),

    // Twilio
    checkService('Twilio', async () => {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return { status: 'error', message: 'Twilio credentials not set' };
      const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const account = await client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      let balance = null;
      try {
        const bal = await client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).balance.fetch();
        balance = parseFloat(bal.balance);
      } catch {}
      if (balance !== null && balance < 5) return { status: 'warning', message: `Low balance: $${balance.toFixed(2)} — texts may stop`, extra: { balance } };
      return { message: `Active${balance !== null ? ` — Balance: $${balance.toFixed(2)}` : ''}`, extra: { balance } };
    }),

    // Internet
    checkService('Internet', async () => {
      const r = await fetch('https://www.google.com', { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { message: 'Outbound OK' };
    }),

    // Railway App (self-check)
    checkService('Railway App', async () => {
      const uptime = process.uptime();
      const mem = process.memoryUsage();
      const mbUsed = Math.round(mem.heapUsed / 1024 / 1024);
      return { message: `Uptime: ${Math.round(uptime / 60)}min — Memory: ${mbUsed}MB`, extra: { uptime: Math.round(uptime), memoryMB: mbUsed } };
    }),
  ]);

  res.json({ services: checks, checkedAt: new Date().toISOString() });
});

module.exports = router;
