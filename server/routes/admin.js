const router = require('express').Router();
const fs = require('fs');
const express = require('express');
const { db, reloadDatabase, saveDb, DB_PATH } = require('../database');
const { authenticate } = require('../middleware');

router.use(authenticate);

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Last backup metadata stored as a setting key.
router.get('/backup-info', requireAdmin, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'last_backup_at'").get();
  res.json({ lastBackupAt: row?.value || null });
});

// Download the entire .sqlite file. Forces a save first so the file on disk
// reflects any pending in-memory writes from the auto-save interval.
router.get('/backup', requireAdmin, (req, res) => {
  try {
    saveDb();
    if (!fs.existsSync(DB_PATH)) return res.status(500).json({ error: 'Database file not found' });
    const today = new Date().toISOString().split('T')[0];
    const filename = `rvpark-backup-${today}.sqlite`;

    const nowIso = new Date().toISOString();
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run('last_backup_at', nowIso, nowIso);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(DB_PATH);
    stream.pipe(res);
  } catch (err) {
    console.error('[admin] backup failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Restore from an uploaded .sqlite file. Body is the raw file bytes.
// Use express.raw at this route only so we don't disturb the JSON parser.
router.post('/restore',
  requireAdmin,
  express.raw({ type: 'application/octet-stream', limit: '50mb' }),
  async (req, res) => {
    try {
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'No file uploaded' });
      // SQLite files start with the magic string "SQLite format 3\0"
      const magic = req.body.slice(0, 16).toString('utf8');
      if (!magic.startsWith('SQLite format 3')) {
        return res.status(400).json({ error: 'Uploaded file does not appear to be a valid SQLite database' });
      }
      await reloadDatabase(req.body);
      res.json({ success: true, sizeBytes: req.body.length });
    } catch (err) {
      console.error('[admin] restore failed:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
