/*
 * Anahuac RV Park — Electric Usage Alerts
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

router.use(authenticate);
router.use(requireAdmin);

// Get active alerts
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM electric_alerts WHERE is_dismissed=0 ORDER BY created_at DESC').all());
});

// Dismiss an alert
router.put('/:id/dismiss', (req, res) => {
  db.prepare("UPDATE electric_alerts SET is_dismissed=1, dismissed_at=datetime('now') WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// Check for anomalies (called after meter readings saved)
function checkElectricAnomalies(lotId, tenantId, kwhUsed) {
  try {
    if (!tenantId) return;
    var tenant = db.prepare('SELECT first_name, last_name, lot_id FROM tenants WHERE id=?').get(tenantId);
    if (!tenant) return;
    var name = tenant.first_name + ' ' + tenant.last_name;

    // Zero usage
    if (kwhUsed === 0) {
      var exists = db.prepare("SELECT id FROM electric_alerts WHERE lot_id=? AND tenant_id=? AND alert_type='zero_usage' AND is_dismissed=0").get(lotId, tenantId);
      if (!exists) {
        db.prepare('INSERT INTO electric_alerts (lot_id, tenant_id, alert_type, message) VALUES (?,?,?,?)').run(
          lotId, tenantId, 'zero_usage', 'Zero electric usage at Lot ' + lotId + ' - ' + name + '. Tenant may have left without notice.'
        );
      }
      return;
    }

    // Get 3-month average
    var avg = db.prepare('SELECT AVG(kwh_used) as a FROM meter_readings WHERE tenant_id=? AND kwh_used > 0 ORDER BY id DESC LIMIT 3').get(tenantId);
    var avgKwh = avg?.a || 0;
    if (avgKwh <= 0) return;

    // Spike (300%+)
    if (kwhUsed >= avgKwh * 3) {
      var exists2 = db.prepare("SELECT id FROM electric_alerts WHERE lot_id=? AND tenant_id=? AND alert_type='spike' AND is_dismissed=0").get(lotId, tenantId);
      if (!exists2) {
        db.prepare('INSERT INTO electric_alerts (lot_id, tenant_id, alert_type, message) VALUES (?,?,?,?)').run(
          lotId, tenantId, 'spike', 'Unusual spike at Lot ' + lotId + ' - ' + name + ': ' + kwhUsed + ' KWH (avg: ' + Math.round(avgKwh) + '). Possible electrical issue.'
        );
      }
    }

    // Very low (90% below)
    if (kwhUsed < avgKwh * 0.1 && kwhUsed > 0) {
      var exists3 = db.prepare("SELECT id FROM electric_alerts WHERE lot_id=? AND tenant_id=? AND alert_type='low_usage' AND is_dismissed=0").get(lotId, tenantId);
      if (!exists3) {
        db.prepare('INSERT INTO electric_alerts (lot_id, tenant_id, alert_type, message) VALUES (?,?,?,?)').run(
          lotId, tenantId, 'low_usage', 'Very low usage at Lot ' + lotId + ' - ' + name + ': ' + kwhUsed + ' KWH (avg: ' + Math.round(avgKwh) + '). Tenant may be away.'
        );
      }
    }
  } catch (e) { console.error('[electric-alerts] check failed:', e.message); }
}

module.exports = router;
module.exports.checkElectricAnomalies = checkElectricAnomalies;
