const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, run } = require('../db/database');
const s3Storage = require('../services/s3Storage');

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

// ── User Management ──────────────────────────────────

// GET /api/admin/users — list all users with roles, gdrive status, media count
router.get('/users', (req, res) => {
  const users = queryAll(`
    SELECT a.*,
      (SELECT COUNT(*) FROM media WHERE account_id = a.id) as media_count,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM media WHERE account_id = a.id) as total_bytes
    FROM accounts a
    WHERE a.username IS NOT NULL
    ORDER BY a.connected_at ASC
  `);

  res.json(users.map(u => ({
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role || 'viewer',
    gdriveConnected: !!(u.gdrive_access_token && u.gdrive_refresh_token),
    gdriveEmail: u.gdrive_email || null,
    mediaCount: u.media_count || 0,
    totalGB: ((u.total_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2),
    connectedAt: u.connected_at,
  })));
});

// PUT /api/admin/users/:id/role — change user role
router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin', 'member', 'viewer'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be: admin, member, or viewer' });
  }

  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
  if (!account) return res.status(404).json({ error: 'User not found' });

  run('UPDATE accounts SET role = ? WHERE id = ?', [role, req.params.id]);
  res.json({ success: true, role });
});

// ── Content Access Grants ────────────────────────────

// GET /api/admin/access — list all access grants
router.get('/access', (req, res) => {
  const grants = queryAll(`
    SELECT sa.*,
      oa.name as owner_name, oa.username as owner_username,
      va.name as viewer_name, va.username as viewer_username
    FROM share_access sa
    JOIN accounts oa ON oa.id = sa.owner_account_id
    JOIN accounts va ON va.id = sa.viewer_account_id
    ORDER BY sa.created_at DESC
  `);

  res.json(grants.map(g => ({
    id: g.id,
    ownerId: g.owner_account_id,
    ownerName: g.owner_name,
    ownerUsername: g.owner_username,
    viewerId: g.viewer_account_id,
    viewerName: g.viewer_name,
    viewerUsername: g.viewer_username,
    createdAt: g.created_at,
  })));
});

// POST /api/admin/access — grant user access to another user's content
router.post('/access', (req, res) => {
  const { viewerId, ownerId } = req.body;
  if (!viewerId || !ownerId) {
    return res.status(400).json({ error: 'viewerId and ownerId required' });
  }
  if (viewerId === ownerId) {
    return res.status(400).json({ error: 'Cannot grant access to own content' });
  }

  // Check both accounts exist
  const viewer = queryOne('SELECT id FROM accounts WHERE id = ?', [viewerId]);
  const owner = queryOne('SELECT id FROM accounts WHERE id = ?', [ownerId]);
  if (!viewer || !owner) {
    return res.status(404).json({ error: 'Account not found' });
  }

  // Check if grant already exists
  const existing = queryOne(
    'SELECT id FROM share_access WHERE owner_account_id = ? AND viewer_account_id = ?',
    [ownerId, viewerId]
  );
  if (existing) {
    return res.json({ success: true, message: 'Access already granted' });
  }

  const id = uuidv4();
  run(
    'INSERT INTO share_access (id, owner_account_id, viewer_account_id, created_at) VALUES (?, ?, ?, ?)',
    [id, ownerId, viewerId, new Date().toISOString()]
  );

  res.json({ success: true, id });
});

// DELETE /api/admin/access/:id — revoke access grant
router.delete('/access/:id', (req, res) => {
  const grant = queryOne('SELECT * FROM share_access WHERE id = ?', [req.params.id]);
  if (!grant) return res.status(404).json({ error: 'Grant not found' });

  run('DELETE FROM share_access WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── Scraper Cookie Management ────────────────────────

const SCRAPER_PLATFORMS = ['youtube', 'instagram', 'tiktok', 'twitter'];

// GET /api/admin/scraper-cookies — check which platforms have cookies configured
router.get('/scraper-cookies', (req, res) => {
  const status = {};
  for (const p of SCRAPER_PLATFORMS) {
    const row = queryOne('SELECT value FROM settings WHERE key = ?', [`scraper_cookies_${p}`]);
    status[p] = !!(row && row.value);
  }
  res.json(status);
});

// PUT /api/admin/scraper-cookies/:platform — save cookie string for a platform
router.put('/scraper-cookies/:platform', (req, res) => {
  const { platform } = req.params;
  if (!SCRAPER_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }

  const { cookies } = req.body;
  if (!cookies || typeof cookies !== 'string' || !cookies.trim()) {
    return res.status(400).json({ error: 'Cookie string required' });
  }

  const key = `scraper_cookies_${platform}`;
  const existing = queryOne('SELECT key FROM settings WHERE key = ?', [key]);

  if (existing) {
    run('UPDATE settings SET value = ? WHERE key = ?', [cookies.trim(), key]);
  } else {
    run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, cookies.trim()]);
  }

  res.json({ success: true });
});

// DELETE /api/admin/scraper-cookies/:platform — clear cookie for a platform
router.delete('/scraper-cookies/:platform', (req, res) => {
  const { platform } = req.params;
  if (!SCRAPER_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }

  run('DELETE FROM settings WHERE key = ?', [`scraper_cookies_${platform}`]);
  res.json({ success: true });
});

// ── Cleanup Endpoints ────────────────────────────────

// DELETE /api/admin/media/all - clear all media
router.delete('/media/all', async (req, res) => {
  const allMedia = queryAll('SELECT id, drive_file_id, drive_thumb_id FROM media');
  for (const m of allMedia) {
    if (m.drive_file_id) await s3Storage.deleteFile(m.drive_file_id);
    if (m.drive_thumb_id) await s3Storage.deleteFile(m.drive_thumb_id);
  }

  run('DELETE FROM media');
  res.json({ success: true });
});

// DELETE /api/admin/accounts/all - disconnect all
router.delete('/accounts/all', (req, res) => {
  run('DELETE FROM media');
  run('DELETE FROM share_access');
  run('DELETE FROM accounts');
  res.json({ success: true });
});

// DELETE /api/admin/person/:accountId - remove person + their media
router.delete('/person/:accountId', async (req, res) => {
  const accountId = req.params.accountId;

  const mediaFiles = queryAll('SELECT id, drive_file_id, drive_thumb_id FROM media WHERE account_id = ?', [accountId]);
  for (const m of mediaFiles) {
    if (m.drive_file_id) await s3Storage.deleteFile(m.drive_file_id);
    if (m.drive_thumb_id) await s3Storage.deleteFile(m.drive_thumb_id);
  }

  run('DELETE FROM media WHERE account_id = ?', [accountId]);
  run('DELETE FROM share_access WHERE owner_account_id = ? OR viewer_account_id = ?', [accountId, accountId]);
  run('DELETE FROM accounts WHERE id = ?', [accountId]);
  res.json({ success: true });
});

module.exports = router;
