/**
 * Google Drive Storage Service
 * Handles uploading, downloading, and deleting files from Google Drive.
 * Uses the "CloudVault" folder (auto-created) with a "thumbnails" subfolder.
 */

const { google } = require('googleapis');
const fs = require('fs');
const { queryOne, run } = require('../db/database');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = require('../config');

// ── Auth helpers (shared with routes/gdrive.js) ──────────────

function getOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

function saveSetting(key, value) {
  const existing = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  if (existing) {
    run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
  } else {
    run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
}

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

// ── Drive helpers ────────────────────────────────────────────

let _cachedFolderId = null;
let _cachedThumbFolderId = null;

async function getDriveInstance() {
  const client = getAuthedClient();
  if (!client) return null;

  // Refresh token if needed
  const tokenInfo = client.credentials;
  if (tokenInfo.expiry_date && tokenInfo.expiry_date < Date.now()) {
    const { credentials } = await client.refreshAccessToken();
    saveSetting('gdrive_access_token', credentials.access_token);
    saveSetting('gdrive_token_expiry', String(credentials.expiry_date || 0));
  }

  return google.drive({ version: 'v3', auth: client });
}

async function getOrCreateFolder(drive, folderName, parentId) {
  let q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const search = await drive.files.list({
    q,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (search.data.files.length > 0) {
    return search.data.files[0].id;
  }

  const requestBody = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) requestBody.parents = [parentId];

  const folder = await drive.files.create({
    requestBody,
    fields: 'id',
  });

  return folder.data.id;
}

async function getCloudVaultFolderId(drive) {
  if (!_cachedFolderId) {
    _cachedFolderId = await getOrCreateFolder(drive, 'CloudVault', null);
  }
  return _cachedFolderId;
}

async function getThumbnailsFolderId(drive) {
  if (!_cachedThumbFolderId) {
    const parentId = await getCloudVaultFolderId(drive);
    _cachedThumbFolderId = await getOrCreateFolder(drive, 'thumbnails', parentId);
  }
  return _cachedThumbFolderId;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Check if Google Drive is connected and ready for storage.
 */
function isConnected() {
  return getAuthedClient() !== null;
}

/**
 * Upload a local file to Google Drive.
 * @param {string} localPath - Path to the file on disk (temp)
 * @param {string} fileName - Display name in Drive
 * @param {string} mimeType - e.g. 'image/jpeg'
 * @param {boolean} isThumbnail - If true, uploads to CloudVault/thumbnails/
 * @returns {string} Google Drive file ID
 */
async function uploadFile(localPath, fileName, mimeType, isThumbnail = false) {
  const drive = await getDriveInstance();
  if (!drive) throw new Error('Google Drive not connected');

  const folderId = isThumbnail
    ? await getThumbnailsFolderId(drive)
    : await getCloudVaultFolderId(drive);

  const result = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(localPath),
    },
    fields: 'id',
  });

  return result.data.id;
}

/**
 * Get a readable stream for a file stored in Google Drive.
 * @param {string} driveFileId - The Drive file ID
 * @returns {{ stream: ReadableStream, mimeType: string, size: number }}
 */
async function getFileStream(driveFileId) {
  const drive = await getDriveInstance();
  if (!drive) throw new Error('Google Drive not connected');

  // Get file metadata for content type
  const meta = await drive.files.get({
    fileId: driveFileId,
    fields: 'mimeType, size, name',
  });

  const response = await drive.files.get(
    { fileId: driveFileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return {
    stream: response.data,
    mimeType: meta.data.mimeType,
    size: parseInt(meta.data.size) || 0,
    name: meta.data.name,
  };
}

/**
 * Delete a file from Google Drive.
 * @param {string} driveFileId - The Drive file ID
 */
async function deleteFile(driveFileId) {
  const drive = await getDriveInstance();
  if (!drive) return; // silently fail if not connected

  try {
    await drive.files.delete({ fileId: driveFileId });
  } catch (err) {
    // Ignore 404 (already deleted) errors
    if (err.code !== 404) {
      console.error('Drive delete error:', err.message);
    }
  }
}

/**
 * Get the Google Drive storage quota for the connected account.
 * Returns { limit, usage, usageInDrive, usageInDriveTrash } in bytes.
 * limit = -1 means unlimited storage.
 */
async function getStorageQuota() {
  const drive = await getDriveInstance();
  if (!drive) throw new Error('Google Drive not connected');

  const about = await drive.about.get({
    fields: 'storageQuota',
  });

  const q = about.data.storageQuota;
  return {
    limit: q.limit ? parseInt(q.limit) : -1,        // -1 = unlimited
    usage: parseInt(q.usage) || 0,
    usageInDrive: parseInt(q.usageInDrive) || 0,
    usageInDriveTrash: parseInt(q.usageInDriveTrash) || 0,
  };
}

/**
 * Clear folder caches (call after disconnect).
 */
function clearCache() {
  _cachedFolderId = null;
  _cachedThumbFolderId = null;
}

module.exports = {
  isConnected,
  uploadFile,
  getFileStream,
  deleteFile,
  getStorageQuota,
  clearCache,
  getDriveInstance,
  getCloudVaultFolderId,
  getThumbnailsFolderId,
  getAuthedClient,
  getOAuth2Client,
  saveSetting,
};
