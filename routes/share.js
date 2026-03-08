const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { queryAll, queryOne, run } = require('../db/database');

// ──────────────────────────
// SHARE LINKS (public URLs)
// ──────────────────────────

// POST /api/share/link - create a share link
router.post('/link', (req, res) => {
  const { accountId, label } = req.body || {};
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });

  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // Check if a link already exists for this account
  const existing = queryOne('SELECT * FROM share_links WHERE account_id = ?', [accountId]);
  if (existing) {
    return res.json({
      id: existing.id,
      token: existing.token,
      label: existing.label,
      accountId: existing.account_id,
      createdAt: existing.created_at,
    });
  }

  const id = 'sl_' + Date.now();
  const token = crypto.randomBytes(16).toString('hex');

  run(
    'INSERT INTO share_links (id, account_id, token, label) VALUES (?, ?, ?, ?)',
    [id, accountId, token, label || '']
  );

  res.json({ id, token, label: label || '', accountId, createdAt: new Date().toISOString() });
});

// DELETE /api/share/link/:id - revoke a share link
router.delete('/link/:id', (req, res) => {
  const link = queryOne('SELECT * FROM share_links WHERE id = ?', [req.params.id]);
  if (!link) return res.status(404).json({ error: 'Share link not found' });

  run('DELETE FROM share_links WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// GET /api/share/link/view/:token - get shared media by token (public)
router.get('/link/view/:token', (req, res) => {
  const link = queryOne('SELECT * FROM share_links WHERE token = ?', [req.params.token]);
  if (!link) return res.status(404).json({ error: 'Share link not found or expired' });

  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [link.account_id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const media = queryAll(
    'SELECT * FROM media WHERE account_id = ? ORDER BY uploaded_at DESC',
    [link.account_id]
  );

  res.json({
    ownerName: account.name,
    media: media.map(row => ({
      id: row.id,
      type: row.type,
      name: row.original_name,
      sizeMB: parseFloat((row.size_bytes / (1024 * 1024)).toFixed(1)),
      date: row.date_taken || row.uploaded_at,
      has_thumbnail: row.has_thumbnail,
      thumbnail: row.drive_thumb_id ? `/api/media/thumb/${row.id}` : null,
      original: row.drive_file_id ? `/api/media/file/${row.id}` : null,
    })),
  });
});

// ──────────────────────────
// USER-TO-USER SHARING
// ──────────────────────────

// POST /api/share/user - share with another user
router.post('/user', (req, res) => {
  const { ownerAccountId, viewerAccountId } = req.body || {};
  if (!ownerAccountId || !viewerAccountId) {
    return res.status(400).json({ error: 'ownerAccountId and viewerAccountId are required' });
  }
  if (ownerAccountId === viewerAccountId) {
    return res.status(400).json({ error: 'Cannot share with yourself' });
  }

  const owner = queryOne('SELECT * FROM accounts WHERE id = ?', [ownerAccountId]);
  if (!owner) return res.status(404).json({ error: 'Owner account not found' });

  const viewer = queryOne('SELECT * FROM accounts WHERE id = ?', [viewerAccountId]);
  if (!viewer) return res.status(404).json({ error: 'Viewer account not found' });

  // Check if already shared
  const existing = queryOne(
    'SELECT * FROM share_access WHERE owner_account_id = ? AND viewer_account_id = ?',
    [ownerAccountId, viewerAccountId]
  );
  if (existing) {
    return res.json({
      id: existing.id,
      ownerAccountId: existing.owner_account_id,
      viewerAccountId: existing.viewer_account_id,
      viewerName: viewer.name,
      viewerUsername: viewer.username,
      createdAt: existing.created_at,
    });
  }

  const id = 'sa_' + Date.now();
  run(
    'INSERT INTO share_access (id, owner_account_id, viewer_account_id) VALUES (?, ?, ?)',
    [id, ownerAccountId, viewerAccountId]
  );

  res.json({
    id,
    ownerAccountId,
    viewerAccountId,
    viewerName: viewer.name,
    viewerUsername: viewer.username,
    createdAt: new Date().toISOString(),
  });
});

// DELETE /api/share/user/:id - revoke user share
router.delete('/user/:id', (req, res) => {
  const share = queryOne('SELECT * FROM share_access WHERE id = ?', [req.params.id]);
  if (!share) return res.status(404).json({ error: 'Share not found' });

  run('DELETE FROM share_access WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// GET /api/share/my/:accountId - get shares for an account
router.get('/my/:accountId', (req, res) => {
  const accountId = req.params.accountId;

  // Get share links I created
  const links = queryAll('SELECT * FROM share_links WHERE account_id = ?', [accountId]);

  // Get users I've shared with
  const sharedWith = queryAll(
    `SELECT sa.*, a.name as viewer_name, a.username as viewer_username
     FROM share_access sa
     JOIN accounts a ON sa.viewer_account_id = a.id
     WHERE sa.owner_account_id = ?`,
    [accountId]
  );

  // Get content shared with me by others
  const sharedWithMe = queryAll(
    `SELECT sa.*, a.name as owner_name, a.username as owner_username
     FROM share_access sa
     JOIN accounts a ON sa.owner_account_id = a.id
     WHERE sa.viewer_account_id = ?`,
    [accountId]
  );

  res.json({
    links: links.map(l => ({
      id: l.id,
      token: l.token,
      label: l.label,
      accountId: l.account_id,
      createdAt: l.created_at,
    })),
    sharedWith: sharedWith.map(s => ({
      id: s.id,
      viewerName: s.viewer_name,
      viewerUsername: s.viewer_username,
      viewerAccountId: s.viewer_account_id,
      createdAt: s.created_at,
    })),
    sharedWithMe: sharedWithMe.map(s => ({
      id: s.id,
      ownerName: s.owner_name,
      ownerUsername: s.owner_username,
      ownerAccountId: s.owner_account_id,
      createdAt: s.created_at,
    })),
  });
});

// GET /api/share/shared-media/:accountId?viewer=ID - get media shared with viewer
router.get('/shared-media/:ownerId', (req, res) => {
  const viewerId = req.query.viewer;
  if (!viewerId) return res.status(400).json({ error: 'viewer query param required' });

  // Check share access exists
  const access = queryOne(
    'SELECT * FROM share_access WHERE owner_account_id = ? AND viewer_account_id = ?',
    [req.params.ownerId, viewerId]
  );
  if (!access) return res.status(403).json({ error: 'No access' });

  const media = queryAll(
    'SELECT * FROM media WHERE account_id = ? ORDER BY uploaded_at DESC',
    [req.params.ownerId]
  );

  res.json(media.map(row => ({
    id: row.id,
    type: row.type,
    name: row.original_name,
    sizeMB: parseFloat((row.size_bytes / (1024 * 1024)).toFixed(1)),
    date: row.date_taken || row.uploaded_at,
    has_thumbnail: row.has_thumbnail,
    thumbnail: row.drive_thumb_id ? `/api/media/thumb/${row.id}` : null,
    original: row.drive_file_id ? `/api/media/file/${row.id}` : null,
  })));
});

module.exports = router;
