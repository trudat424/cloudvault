const express = require('express');
const router = express.Router();
const { queryOne, run } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

// GET /api/gdrive/status
router.get('/status', (req, res) => {
  const row = queryOne("SELECT value FROM settings WHERE key = 'gdrive_connected'");
  res.json({ connected: row ? row.value === 'true' : false });
});

// POST /api/gdrive/connect (stub)
router.post('/connect', (req, res) => {
  const existing = queryOne("SELECT value FROM settings WHERE key = 'gdrive_connected'");
  if (existing) {
    run("UPDATE settings SET value = 'true' WHERE key = 'gdrive_connected'");
  } else {
    run("INSERT INTO settings (key, value) VALUES ('gdrive_connected', 'true')");
  }
  res.json({ connected: true });
});

// DELETE /api/gdrive/disconnect
router.delete('/disconnect', (req, res) => {
  run("DELETE FROM settings WHERE key = 'gdrive_connected'");
  res.json({ connected: false });
});

// POST /api/gdrive/transfer (stub - simulates transfer)
router.post('/transfer', (req, res) => {
  const { ids, count, totalMB } = req.body;
  const fileCount = count || (ids ? ids.length : 0);

  run(
    'INSERT INTO transfer_history (id, type, description, file_count, size_bytes, status) VALUES (?, ?, ?, ?, ?, ?)',
    [
      uuidv4(),
      'transfer',
      `Transferred ${fileCount} files to Google Drive`,
      fileCount,
      Math.round((totalMB || 0) * 1024 * 1024),
      'complete',
    ]
  );

  res.json({ success: true, transferred: fileCount });
});

module.exports = router;
