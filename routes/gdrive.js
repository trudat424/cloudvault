const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, run } = require('../db/database');
const { DATA_DIR, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = require('../config');

// Scopes: access to files we create + ability to create files
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

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
    res.json({
      connected: true,
      email: about.data.user.emailAddress,
      name: about.data.user.displayName,
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

module.exports = router;
