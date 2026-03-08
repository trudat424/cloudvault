const express = require('express');
const router = express.Router();
const { queryAll, queryOne, run } = require('../db/database');
const driveStorage = require('../services/driveStorage');

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const row = queryOne("SELECT value FROM settings WHERE key = 'admin_password'");
  const adminPassword = row ? row.value : (process.env.ADMIN_PASSWORD || 'bob123');

  if (password === adminPassword) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const media = queryAll(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN type = 'photo' THEN 1 ELSE 0 END) as photos,
      SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END) as videos,
      COUNT(DISTINCT account_id) as people,
      COALESCE(SUM(size_bytes), 0) as totalBytes
    FROM media
  `);
  const accounts = queryAll('SELECT COUNT(*) as count FROM accounts');
  const stats = media[0] || {};

  res.json({
    total: stats.total || 0,
    photos: stats.photos || 0,
    videos: stats.videos || 0,
    people: stats.people || 0,
    totalGB: ((stats.totalBytes || 0) / (1024 * 1024 * 1024)).toFixed(1),
    accounts: accounts[0] ? accounts[0].count : 0,
  });
});

// DELETE /api/admin/media/all - clear all media
router.delete('/media/all', async (req, res) => {
  // Delete all files from Google Drive
  const allMedia = queryAll('SELECT drive_file_id, drive_thumb_id FROM media');
  for (const m of allMedia) {
    if (m.drive_file_id) await driveStorage.deleteFile(m.drive_file_id);
    if (m.drive_thumb_id) await driveStorage.deleteFile(m.drive_thumb_id);
  }

  run('DELETE FROM media');
  res.json({ success: true });
});

// DELETE /api/admin/accounts/all - disconnect all
router.delete('/accounts/all', (req, res) => {
  run('DELETE FROM accounts');
  run("DELETE FROM settings WHERE key = 'gdrive_connected'");
  res.json({ success: true });
});

// DELETE /api/admin/person/:accountId - remove person + their media
router.delete('/person/:accountId', async (req, res) => {
  const accountId = req.params.accountId;

  // Get all media files for this person and delete from Drive
  const mediaFiles = queryAll('SELECT drive_file_id, drive_thumb_id FROM media WHERE account_id = ?', [accountId]);
  for (const m of mediaFiles) {
    if (m.drive_file_id) await driveStorage.deleteFile(m.drive_file_id);
    if (m.drive_thumb_id) await driveStorage.deleteFile(m.drive_thumb_id);
  }

  run('DELETE FROM media WHERE account_id = ?', [accountId]);
  run('DELETE FROM accounts WHERE id = ?', [accountId]);
  res.json({ success: true });
});

module.exports = router;
