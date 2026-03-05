const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, run } = require('../db/database');
const { DATA_DIR, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_API_KEY } = require('../config');
const { generateThumbnail } = require('../services/thumbnail');
const { extractMetadata } = require('../services/metadata');

// Only drive.file scope — non-sensitive, no "unverified app" warning
// Google Picker grants per-file access under this scope
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
];

function getOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// Load stored tokens from DB into an OAuth2 client
function getAuthedClient() {
  const accessToken = queryOne("SELECT value FROM settings WHERE key = 'gdrive_access_token'");
  const refreshToken = queryOne("SELECT value FROM settings WHERE key = 'gdrive_refresh_token'");
  const tokenExpiry = queryOne("SELECT value FROM settings WHERE key = 'gdrive_token_expiry'");

  if (!accessToken || !refreshToken) return null;

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: accessToken.value,
    refresh_token: refreshToken.value,
    expiry_date: tokenExpiry ? parseInt(tokenExpiry.value) : 0,
  });

  return client;
}

function saveSetting(key, value) {
  const existing = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  if (existing) {
    run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
  } else {
    run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
}

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

    // Refresh credentials to get latest access token
    const creds = client.credentials;

    res.json({
      connected: true,
      email: about.data.user.emailAddress,
      name: about.data.user.displayName,
      // Picker config — frontend needs these to open Google Picker
      accessToken: creds.access_token,
      apiKey: GOOGLE_API_KEY,
      clientId: GOOGLE_CLIENT_ID,
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

// Find or create "CloudVault" folder in Drive root
async function getOrCreateFolder(drive) {
  const folderName = 'CloudVault';

  // Search for existing folder
  const search = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (search.data.files.length > 0) {
    return search.data.files[0].id;
  }

  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  return folder.data.id;
}

// POST /api/gdrive/transfer — upload files to Google Drive
router.post('/transfer', async (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No file IDs provided' });
  }

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
    const folderId = await getOrCreateFolder(drive);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const mediaId of ids) {
      const media = queryOne('SELECT * FROM media WHERE id = ?', [mediaId]);
      if (!media) {
        results.push({ id: mediaId, success: false, error: 'Not found' });
        failCount++;
        continue;
      }

      const filePath = path.join(DATA_DIR, 'uploads', 'originals', media.stored_name);
      if (!fs.existsSync(filePath)) {
        results.push({ id: mediaId, success: false, error: 'File missing' });
        failCount++;
        continue;
      }

      try {
        const mimeType = media.type === 'video' ? 'video/mp4' : 'image/jpeg';
        const ext = path.extname(media.stored_name);

        await drive.files.create({
          requestBody: {
            name: media.original_name || `cloudvault_${mediaId}${ext}`,
            parents: [folderId],
          },
          media: {
            mimeType,
            body: fs.createReadStream(filePath),
          },
          fields: 'id,name',
        });

        results.push({ id: mediaId, success: true, name: media.original_name });
        successCount++;
      } catch (uploadErr) {
        console.error(`Failed to upload ${mediaId}:`, uploadErr.message);
        results.push({ id: mediaId, success: false, error: uploadErr.message });
        failCount++;
      }
    }

    // Record transfer in history
    const totalSize = ids.reduce((sum, id) => {
      const m = queryOne('SELECT size_bytes FROM media WHERE id = ?', [id]);
      return sum + (m ? m.size_bytes : 0);
    }, 0);

    run(
      'INSERT INTO transfer_history (id, type, description, file_count, size_bytes, status) VALUES (?, ?, ?, ?, ?, ?)',
      [
        uuidv4(),
        'transfer',
        `Transferred ${successCount} files to Google Drive`,
        successCount,
        totalSize,
        failCount === 0 ? 'complete' : 'partial',
      ]
    );

    res.json({
      success: true,
      transferred: successCount,
      failed: failCount,
      total: ids.length,
      results,
    });
  } catch (err) {
    console.error('Transfer error:', err.message);
    res.status(500).json({ error: 'Transfer failed: ' + err.message });
  }
});

// Helper: ensure upload directories exist
function ensureDirs() {
  const origDir = path.join(DATA_DIR, 'uploads', 'originals');
  const thumbDir = path.join(DATA_DIR, 'uploads', 'thumbnails');
  if (!fs.existsSync(origDir)) fs.mkdirSync(origDir, { recursive: true });
  if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
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

    ensureDirs();

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

        // Download file from Drive
        const fileId = uuidv4();
        const ext = getExtFromMime(file.mimeType) || path.extname(file.name) || '.jpg';
        const storedName = `${fileId}${ext}`;
        const filePath = path.join(DATA_DIR, 'uploads', 'originals', storedName);

        const response = await drive.files.get(
          { fileId: file.id, alt: 'media' },
          { responseType: 'stream' }
        );

        // Write stream to file
        await new Promise((resolve, reject) => {
          const dest = fs.createWriteStream(filePath);
          response.data.pipe(dest);
          dest.on('finish', resolve);
          dest.on('error', reject);
        });

        const fileStats = fs.statSync(filePath);
        const isVideo = file.mimeType.startsWith('video/');
        const type = isVideo ? 'video' : 'photo';

        // Extract metadata for images
        let meta = {};
        if (!isVideo) {
          meta = await extractMetadata(filePath);
        }

        // Generate thumbnail for images
        let hasThumbnail = 0;
        if (!isVideo) {
          const thumbPath = path.join(DATA_DIR, 'uploads', 'thumbnails', fileId + '.jpg');
          hasThumbnail = (await generateThumbnail(filePath, thumbPath)) ? 1 : 0;
        }

        // Insert into media table
        run(
          `INSERT INTO media (id, account_id, person_name, person_email, type,
            original_name, stored_name, mime_type, size_bytes,
            width, height, date_taken, latitude, longitude,
            camera_make, camera_model, has_thumbnail, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fileId, account.id, account.name, account.email, type,
            file.name, storedName, file.mimeType, fileStats.size,
            meta.width || null, meta.height || null,
            meta.dateTaken || new Date().toISOString(),
            meta.latitude || null, meta.longitude || null,
            meta.cameraMake || null, meta.cameraModel || null,
            hasThumbnail, file.id,
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
