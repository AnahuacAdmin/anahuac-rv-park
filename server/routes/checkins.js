const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');
const { sendSms } = require('../twilio');

router.use(authenticate);

const APP_URL = 'https://web-production-89794.up.railway.app';

router.get('/', (req, res) => {
  const checkins = db.prepare(`
    SELECT c.*, t.first_name, t.last_name, l.id as lot_name
    FROM checkins c
    JOIN tenants t ON c.tenant_id = t.id
    JOIN lots l ON c.lot_id = l.id
    ORDER BY c.created_at DESC
  `).all();
  res.json(checkins);
});

router.post('/checkin', (req, res) => {
  try {
    const { tenant_id, lot_id, check_in_date, notes } = req.body;
    const str = (v) => (v === undefined || v === null || v === '') ? null : String(v);
    const result = db.prepare(`
      INSERT INTO checkins (tenant_id, lot_id, check_in_date, status, notes)
      VALUES (?, ?, ?, 'checked_in', ?)
    `).run(tenant_id, lot_id, str(check_in_date), str(notes));
    db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('occupied', lot_id);

    // Auto-send welcome SMS (non-blocking — failure doesn't break check-in).
    try {
      const tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id = ?').get(tenant_id);
      if (tenant?.phone) {
        const welcomeMsg = `Welcome to Anahuac RV Park! We're glad you're here!\n\nLot: ${lot_id}\nContact: 409-267-6603 | anrvpark.com\n\nPARK RULES SUMMARY:\n- Rent due on time — late fees apply after 3 days\n- Speed limit: 5 MPH — children & ducks in park!\n- Quiet hours: 10pm–7am\n- Pets welcome on leash — clean up after them\n- Max 2 people/cars per space ($25/extra person)\n- No fires except pits/rings. No fireworks. No weapons.\n- Keep your site clean at all times\n- No subleasing. No sharing WiFi password.\n- Guests: max 2 visitors at a time\n\nPay invoices online: ${APP_URL}\n\nWelcome to your new home away from home! 🦆`;
        sendSms(tenant.phone, welcomeMsg).then(r => {
          console.log(`[checkins] welcome SMS sent to ${r.to}, sid=${r.sid}`);
        }).catch(e => {
          console.error('[checkins] welcome SMS failed (non-fatal):', e.message);
        });
      }
    } catch (smsErr) {
      console.error('[checkins] welcome SMS setup failed (non-fatal):', smsErr.message);
    }

    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    console.error('[checkins] checkin failed:', err);
    res.status(500).json({ error: 'Check-in failed: ' + err.message });
  }
});

router.post('/checkout', (req, res) => {
  const { tenant_id, lot_id, check_out_date, notes } = req.body;

  db.prepare(`
    UPDATE checkins SET check_out_date = ?, status = 'checked_out', notes = ?
    WHERE tenant_id = ? AND lot_id = ? AND status = 'checked_in'
  `).run(check_out_date, notes, tenant_id, lot_id);

  db.prepare('UPDATE tenants SET is_active = 0, move_out_date = ? WHERE id = ?')
    .run(check_out_date, tenant_id);
  db.prepare('UPDATE lots SET status = ? WHERE id = ?').run('vacant', lot_id);

  res.json({ success: true });
});

// Send welcome SMS (two messages) to a newly checked-in tenant.
router.post('/welcome-sms/:tenantId', async (req, res) => {
  try {
    const tenant = db.prepare('SELECT first_name, phone FROM tenants WHERE id = ?').get(req.params.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (!tenant.phone) return res.json({ sent: false, reason: 'No phone on file' });

    const msg1 = `Welcome to Anahuac RV Park! We are so glad you chose us as your home. Here is your app link to manage your account and pay online: ${APP_URL}`;
    const msg2 = `PARK RULES: Quiet hours 10pm-7am. Speed limit 5mph. Keep your lot clean. Rent due 1st of month, late after 5th. No open fires. Pets on leash. Questions? Call 409-267-6603`;

    await sendSms(tenant.phone, msg1);
    await sendSms(tenant.phone, msg2);

    res.json({ sent: true, sentTo: tenant.phone });
  } catch (err) {
    console.error('[checkins] welcome sms failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
