/*
 * Anahuac RV Park — Weekly Database Backup Email
 * Sends a full database backup to anrvpark@gmail.com every Sunday at 3 AM CST.
 * Also runs a daily in-memory snapshot of admin-edited tables for quick recovery.
 */
const { db, saveDb, DB_PATH } = require('../database');
const { Resend } = require('resend');
const fs = require('fs');

const BACKUP_EMAIL = 'anrvpark@gmail.com';
const FROM_ADDRESS = 'Anahuac RV Park <invoices@anrvpark.com>';

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// Tables that contain admin-curated data (not auto-generated)
const CURATED_TABLES = [
  'local_restaurants',
  'tenants',
  'lots',
  'invoices',
  'payments',
  'announcements',
  'settings',
];

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function nowCST() {
  return new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
}

// Generate a CSV export of a table
function tableToCSV(tableName) {
  try {
    var rows = db.prepare('SELECT * FROM ' + tableName).all();
    if (!rows || !rows.length) return null;
    var cols = Object.keys(rows[0]);
    var lines = [cols.join(',')];
    rows.forEach(function(row) {
      lines.push(cols.map(function(c) {
        var val = row[c];
        if (val == null) return '';
        var s = String(val);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(','));
    });
    return lines.join('\n');
  } catch (e) {
    console.error('[backup] CSV export failed for ' + tableName + ':', e.message);
    return null;
  }
}

// Send weekly backup email with DB file + CSV summaries
async function sendWeeklyBackup() {
  var resend = getResend();
  if (!resend) {
    console.warn('[backup] RESEND_API_KEY not set — skipping weekly backup email');
    return;
  }

  try {
    // Force save to disk first
    saveDb();

    // Read the database file
    var dbBuffer = fs.readFileSync(DB_PATH);
    var dbBase64 = dbBuffer.toString('base64');

    // Build CSV attachments for curated tables
    var attachments = [{
      filename: 'rvpark-backup-' + todayStr() + '.sqlite',
      content: dbBase64,
      type: 'application/x-sqlite3',
    }];

    var tableSummary = [];
    CURATED_TABLES.forEach(function(table) {
      var csv = tableToCSV(table);
      if (csv) {
        attachments.push({
          filename: table + '-' + todayStr() + '.csv',
          content: Buffer.from(csv).toString('base64'),
          type: 'text/csv',
        });
        var rowCount = csv.split('\n').length - 1;
        tableSummary.push(table + ': ' + rowCount + ' rows');
      }
    });

    await resend.emails.send({
      from: FROM_ADDRESS,
      to: BACKUP_EMAIL,
      subject: 'Weekly Backup — Anahuac RV Park — ' + todayStr(),
      text: [
        'Weekly Database Backup',
        '=====================',
        'Date: ' + nowCST(),
        '',
        'Attached: Full SQLite database + CSV exports of key tables.',
        '',
        'Table summary:',
        tableSummary.join('\n'),
        '',
        'To restore: Go to Admin > Settings > Restore Database and upload the .sqlite file.',
        '',
        '— Anahuac RV Park Automated Backup System',
      ].join('\n'),
      attachments: attachments,
    });

    // Record backup timestamp
    try {
      db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run('last_weekly_backup', nowCST());
    } catch {}

    console.log('[backup] weekly backup email sent to ' + BACKUP_EMAIL + ' (' + tableSummary.join(', ') + ')');
  } catch (e) {
    console.error('[backup] weekly backup email failed:', e.message);
  }
}

// Schedule: check every hour, send on Sunday at 3 AM CST
function start() {
  var sent = {};

  function check() {
    var now = new Date();
    var cst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    var day = cst.getDay(); // 0 = Sunday
    var hour = cst.getHours();
    var dateKey = todayStr();

    // Sunday 3 AM CST
    if (day === 0 && hour === 3 && !sent[dateKey]) {
      sent[dateKey] = true;
      sendWeeklyBackup().catch(function(e) { console.error('[backup] error:', e.message); });
    }
  }

  // Check every 30 minutes
  setInterval(check, 30 * 60 * 1000);
  // Also check on startup (in case server just restarted on a Sunday morning)
  setTimeout(check, 10000);

  console.log('[backup] weekly backup job started (Sundays 3 AM CST → ' + BACKUP_EMAIL + ')');
}

module.exports = { start, sendWeeklyBackup };
