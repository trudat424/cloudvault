const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { queryAll, queryOne, run } = require('../db/database');
const { DATA_DIR } = require('../config');

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
router.delete('/media/all', (req, res) => {
  // Delete all files from disk
  const uploadsDir = path.join(DATA_DIR, 'uploads');
  clearDirectory(path.join(uploadsDir, 'originals'));
  clearDirectory(path.join(uploadsDir, 'thumbnails'));

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
router.delete('/person/:accountId', (req, res) => {
  const accountId = req.params.accountId;

  // Get all media files for this person
  const mediaFiles = queryAll('SELECT stored_name FROM media WHERE account_id = ?', [accountId]);

  // Delete files from disk
  for (const file of mediaFiles) {
    const origPath = path.join(DATA_DIR, 'uploads', 'originals', file.stored_name);
    const thumbName = path.basename(file.stored_name, path.extname(file.stored_name)) + '.jpg';
    const thumbPath = path.join(DATA_DIR, 'uploads', 'thumbnails', thumbName);

    try { fs.unlinkSync(origPath); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }
  }

  run('DELETE FROM media WHERE account_id = ?', [accountId]);
  run('DELETE FROM accounts WHERE id = ?', [accountId]);
  res.json({ success: true });
});

function clearDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    try { fs.unlinkSync(path.join(dirPath, file)); } catch (e) { /* ignore */ }
  }
}

module.exports = router;
