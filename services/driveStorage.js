/**
 * Google Drive Service (Per-User) — READ-ONLY
 * Used only for browsing/importing files FROM Google Drive.
 * All file storage is handled by S3 (see s3Storage.js).
 */

const { google } = require('googleapis');
const { queryOne, run } = require('../db/database');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = require('../config');

// ── Auth helpers ─────────────────────────────────────────────

function getOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/**
 * Save a Drive token field on a user's account row.
 */
function saveAccountToken(accountId, column, value) {
  const allowed = ['gdrive_access_token', 'gdrive_refresh_token', 'gdrive_token_expiry', 'gdrive_email', 'gdrive_scope'];
  if (!allowed.includes(column)) throw new Error('Invalid token column: ' + column);
  run(`UPDATE accounts SET ${column} = ? WHERE id = ?`, [value, accountId]);
}

/**
 * Get an authenticated OAuth2 client for a specific user.
 */
function getAuthedClient(accountId) {
  if (!accountId) return null;
  const account = queryOne(
    'SELECT gdrive_access_token, gdrive_refresh_token, gdrive_token_expiry FROM accounts WHERE id = ?',
    [accountId]
  );
  if (!account || !account.gdrive_access_token || !account.gdrive_refresh_token) return null;

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: account.gdrive_access_token,
    refresh_token: account.gdrive_refresh_token,
    expiry_date: account.gdrive_token_expiry ? parseInt(account.gdrive_token_expiry) : 0,
  });
  return client;
}

// ── Drive helpers ────────────────────────────────────────────

async function getDriveInstance(accountId) {
  const client = getAuthedClient(accountId);
  if (!client) return null;

  const tokenInfo = client.credentials;
  if (tokenInfo.expiry_date && tokenInfo.expiry_date < Date.now()) {
    const { credentials } = await client.refreshAccessToken();
    saveAccountToken(accountId, 'gdrive_access_token', credentials.access_token);
    saveAccountToken(accountId, 'gdrive_token_expiry', String(credentials.expiry_date || 0));
  }

  return google.drive({ version: 'v3', auth: client });
}

// ── Public API ───────────────────────────────────────────────

function isConnected(accountId) {
  return getAuthedClient(accountId) !== null;
}

async function getStorageQuota(accountId) {
  const drive = await getDriveInstance(accountId);
  if (!drive) throw new Error('Google Drive not connected');

  const about = await drive.about.get({ fields: 'storageQuota' });
  const q = about.data.storageQuota;
  return {
    limit: q.limit ? parseInt(q.limit) : -1,
    usage: parseInt(q.usage) || 0,
    usageInDrive: parseInt(q.usageInDrive) || 0,
    usageInDriveTrash: parseInt(q.usageInDriveTrash) || 0,
  };
}

function clearCache(accountId) {
  // No-op — folder cache removed (S3 handles storage now)
}

module.exports = {
  isConnected,
  getStorageQuota,
  clearCache,
  getDriveInstance,
  getAuthedClient,
  getOAuth2Client,
  saveAccountToken,
};
