const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, run } = require('../db/database');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, STORAGE_LIMIT_GB } = require('../config');
const { generateThumbnail } = require('../services/thumbnail');
const { extractMetadata } = require('../services/metadata');
const driveStorage = require('../services/driveStorage');

// drive.file = upload/read/delete files the app creates
// drive.readonly = browse all Drive files (Drive browser feature)
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
];

// Reuse shared helpers from driveStorage
const { getOAuth2Client, getAuthedClient, saveSetting } = driveStorage;

function deleteSetting(key) {
  run('DELETE FROM settings WHERE key = ?', [key]);
}

// GET /api/gdrive/auth — redirect user to Google consent screen
router.get('/auth', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth credentials not configured' });
  }

  const client = getOAuth2Client();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  res.redirect(authUrl);
});

// GET /api/gdrive/callback — handle OAuth redirect from Google
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?gdrive=error&reason=' + encodeURIComponent(error));
  }

  if (!code) {
    return res.redirect('/?gdrive=error&reason=no_code');
  }

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);

    saveSetting('gdrive_access_token', tokens.access_token);
    if (tokens.refresh_token) {
      saveSetting('gdrive_refresh_token', tokens.refresh_token);
    }
    saveSetting('gdrive_token_expiry', String(tokens.expiry_date || 0));
    saveSetting('gdrive_connected', 'true');
    saveSetting('gdrive_scope', SCOPES.join(' '));

    res.redirect('/?gdrive=connected');
  } catch (err) {
    console.error('Google OAuth callback error:', err.message);
    res.redirect('/?gdrive=error&reason=' + encodeURIComponent(err.message));
  }
});

// GET /api/gdrive/status — check if connected with valid tokens
router.get('/status', async (req, res) => {
  const client = getAuthedClient();
  if (!client) {
    return res.json({ connected: false });
  }

  try {
    // Try to get token info / refresh if needed
    const tokenInfo = client.credentials;
    if (tokenInfo.expiry_date && tokenInfo.expiry_date < Date.now()) {
      const { credentials } = await client.refreshAccessToken();
      saveSetting('gdrive_access_token', credentials.access_token);
      saveSetting('gdrive_token_expiry', String(credentials.expiry_date || 0));
    }

    // Verify token works by getting user info
    const drive = google.drive({ version: 'v3', auth: client });
    const about = await drive.about.get({ fields: 'user' });

    // Check if stored scope matches current required scope
    const storedScope = queryOne("SELECT value FROM settings WHERE key = 'gdrive_scope'");
    const needsReauth = !storedScope || storedScope.value !== SCOPES.join(' ');

    // Refresh credentials to get latest access token
    const creds = client.credentials;

    res.json({
      connected: true,
      needsReauth,
      email: about.data.user.emailAddress,
      name: about.data.user.displayName,
      accessToken: creds.access_token,
    });
  } catch (err) {
    console.error('GDrive status check failed:', err.message);
    // Token invalid — clean up
    deleteSetting('gdrive_access_token');
    deleteSetting('gdrive_refresh_token');
    deleteSetting('gdrive_token_expiry');
    deleteSetting('gdrive_connected');
    res.json({ connected: false });
  }
});

// GET /api/gdrive/quota — real Google Drive storage quota
router.get('/quota', async (req, res) => {
  try {
    const quota = await driveStorage.getStorageQuota();
    const limitGB = quota.limit > 0 ? parseFloat((quota.limit / (1024 ** 3)).toFixed(2)) : -1;
    const usageGB = parseFloat((quota.usage / (1024 ** 3)).toFixed(2));
    const usageInDriveGB = parseFloat((quota.usageInDrive / (1024 ** 3)).toFixed(2));
    const trashGB = parseFloat((quota.usageInDriveTrash / (1024 ** 3)).toFixed(2));

    res.json({
      limitBytes: quota.limit,
      usageBytes: quota.usage,
      limitGB,
      usageGB,
      usageInDriveGB,
      trashGB,
      percentUsed: quota.limit > 0 ? parseFloat(((quota.usage / quota.limit) * 100).toFixed(1)) : 0,
    });
  } catch (err) {
    console.error('Drive quota error:', err.message);
    res.status(500).json({ error: 'Failed to fetch storage quota' });
  }
});

// GET /api/gdrive/files — list photos & videos from user's Drive
router.get('/files', async (req, res) => {
  const client = getAuthedClient();
  if (!client) {
    return res.status(401).json({ error: 'Google Drive not connected' });
  }

  try {
    // Refresh token if needed
    const tokenInfo = client.credentials;
    if (tokenInfo.expiry_date && tokenInfo.expiry_date < Date.now()) {
      const { credentials } = await client.refreshAccessToken();
      saveSetting('gdrive_access_token', credentials.access_token);
      saveSetting('gdrive_token_expiry', String(credentials.expiry_date || 0));
    }

    const drive = google.drive({ version: 'v3', auth: client });

    // Build query — photos and videos only
    let q = "(mimeType contains 'image/' or mimeType contains 'video/') and trashed = false";
    const searchQuery = req.query.q;
    if (searchQuery) {
      q += ` and name contains '${searchQuery.replace(/'/g, "\\'")}'`;
    }

    const params = {
      q,
      fields: 'files(id, name, mimeType, thumbnailLink, modifiedTime, size), nextPageToken',
      pageSize: 50,
      orderBy: 'modifiedTime desc',
    };

    if (req.query.pageToken) {
      params.pageToken = req.query.pageToken;
    }

    const result = await drive.files.list(params);

    res.json({
      files: result.data.files || [],
      nextPageToken: result.data.nextPageToken || null,
    });
  } catch (err) {
    console.error('Drive files list error:', err.message);
    res.status(500).json({ error: 'Failed to list Drive files: ' + err.message });
  }
});

// DELETE /api/gdrive/disconnect — revoke tokens
router.delete('/disconnect', async (req, res) => {
  const client = getAuthedClient();

  if (client) {
    try {
      await client.revokeCredentials();
    } catch (err) {
      // Ignore revocation errors
    }
  }

  deleteSetting('gdrive_access_token');
  deleteSetting('gdrive_refresh_token');
  deleteSetting('gdrive_token_expiry');
  deleteSetting('gdrive_connected');

  res.json({ connected: false });
});

// Helper: ensure temp directory exists
function ensureTempDir() {
  const tmpDir = path.join(os.tmpdir(), 'cloudvault-imports');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

// Helper: get or create a gdrive account for the connected user
function getOrCreateGDriveAccount(email, displayName) {
  let account = queryOne("SELECT * FROM accounts WHERE email = ? AND type = 'gdrive'", [email]);
  if (!account) {
    const id = 'acc_' + Date.now();
    run(
      'INSERT INTO accounts (id, name, email, type, connected_at) VALUES (?, ?, ?, ?, ?)',
      [id, displayName || email, email, 'gdrive', new Date().toISOString()]
    );
    account = queryOne('SELECT * FROM accounts WHERE id = ?', [id]);
  }
  return account;
}

// Helper: get mime extension mapping
function getExtFromMime(mimeType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/webm': '.webm',
    'video/3gpp': '.3gp',
  };
  return map[mimeType] || '.jpg';
}

// POST /api/gdrive/import — import Picker-selected files from Google Drive (SSE)
// Body: { files: [{ id, name, mimeType }] }
router.post('/import', async (req, res) => {
  const client = getAuthedClient();
  if (!client) {
    return res.status(401).json({ error: 'Google Drive not connected' });
  }

  const { files } = req.body;
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  function sendSSE(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    // Refresh token if needed
    const tokenInfo = client.credentials;
    if (tokenInfo.expiry_date && tokenInfo.expiry_date < Date.now()) {
      const { credentials } = await client.refreshAccessToken();
      saveSetting('gdrive_access_token', credentials.access_token);
      saveSetting('gdrive_token_expiry', String(credentials.expiry_date || 0));
    }

    const drive = google.drive({ version: 'v3', auth: client });

    // Get user info for account linking
    const about = await drive.about.get({ fields: 'user' });
    const userEmail = about.data.user.emailAddress;
    const userName = about.data.user.displayName;
    const account = getOrCreateGDriveAccount(userEmail, userName);

    // Filter out already-imported files (by source_id = Drive file ID)
    const newFiles = files.filter(f => {
      const existing = queryOne('SELECT id FROM media WHERE source_id = ?', [f.id]);
      return !existing;
    });

    const total = newFiles.length;
    const skipped = files.length - total;

    sendSSE('progress', {
      status: 'importing',
      message: `${files.length} selected, ${total} new to import`,
      total,
      current: 0,
      skipped,
    });

    if (total === 0) {
      sendSSE('done', {
        message: 'All selected files already imported',
        imported: 0,
        skipped,
        failed: 0,
      });
      res.end();
      return;
    }

    const tmpDir = ensureTempDir();

    let imported = 0;
    let failed = 0;

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];

      try {
        sendSSE('progress', {
          status: 'importing',
          message: `Importing: ${file.name}`,
          total,
          current: i + 1,
          fileName: file.name,
        });

        // Download file from Drive to temp
        const fileId = uuidv4();
        const ext = getExtFromMime(file.mimeType) || path.extname(file.name) || '.jpg';
        const storedName = `${fileId}${ext}`;
        const tempPath = path.join(tmpDir, storedName);

        const response = await drive.files.get(
          { fileId: file.id, alt: 'media' },
          { responseType: 'stream' }
        );

        // Write stream to temp file
        await new Promise((resolve, reject) => {
          const dest = fs.createWriteStream(tempPath);
          response.data.pipe(dest);
          dest.on('finish', resolve);
          dest.on('error', reject);
        });

        const fileStats = fs.statSync(tempPath);
        const isVideo = file.mimeType.startsWith('video/');
        const type = isVideo ? 'video' : 'photo';

        // Extract metadata for images
        let meta = {};
        if (!isVideo) {
          meta = await extractMetadata(tempPath);
        }

        // Upload original to CloudVault folder in Drive
        const driveFileId = await driveStorage.uploadFile(tempPath, file.name, file.mimeType, false);

        // Generate + upload thumbnail for images
        let hasThumbnail = 0;
        let driveThumbId = null;
        if (!isVideo) {
          const thumbPath = path.join(tmpDir, fileId + '_thumb.jpg');
          hasThumbnail = (await generateThumbnail(tempPath, thumbPath)) ? 1 : 0;
          if (hasThumbnail) {
            driveThumbId = await driveStorage.uploadFile(thumbPath, fileId + '.jpg', 'image/jpeg', true);
            try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }
          }
        }

        // Clean up temp original
        try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }

        // Insert into media table
        run(
          `INSERT INTO media (id, account_id, person_name, person_email, type,
            original_name, stored_name, mime_type, size_bytes,
            width, height, date_taken, latitude, longitude,
            camera_make, camera_model, has_thumbnail, source_id,
            drive_file_id, drive_thumb_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fileId, account.id, account.name, account.email, type,
            file.name, storedName, file.mimeType, fileStats.size,
            meta.width || null, meta.height || null,
            meta.dateTaken || new Date().toISOString(),
            meta.latitude || null, meta.longitude || null,
            meta.cameraMake || null, meta.cameraModel || null,
            hasThumbnail, file.id,
            driveFileId, driveThumbId,
          ]
        );

        imported++;
      } catch (importErr) {
        console.error(`Failed to import ${file.name}:`, importErr.message);
        failed++;
      }
    }

    // Record in transfer history
    const totalSize = queryOne(
      "SELECT COALESCE(SUM(size_bytes), 0) as total FROM media WHERE source_id IS NOT NULL AND account_id = ?",
      [account.id]
    );

    run(
      'INSERT INTO transfer_history (id, type, description, file_count, size_bytes, status) VALUES (?, ?, ?, ?, ?, ?)',
      [
        uuidv4(),
        'import',
        `Imported ${imported} files from Google Drive`,
        imported,
        totalSize ? totalSize.total : 0,
        failed === 0 ? 'complete' : 'partial',
      ]
    );

    sendSSE('done', {
      message: `Import complete: ${imported} imported, ${failed} failed`,
      imported,
      skipped,
      failed,
    });

    res.end();
  } catch (err) {
    console.error('Import error:', err.message);
    sendSSE('error', { message: 'Import failed: ' + err.message });
    res.end();
  }
});

module.exports = router;
