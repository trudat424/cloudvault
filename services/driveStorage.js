/**
 * Google Drive Storage Service (Per-User)
 * Each user has their own Google Drive connection.
 * Tokens are stored on the accounts table, not in global settings.
 */

const { google } = require('googleapis');
const fs = require('fs');
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

// Per-user folder cache: Map<accountId, { folderId, thumbFolderId }>
const _folderCache = new Map();

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

async function getOrCreateFolder(drive, folderName, parentId) {
  let q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const search = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' });

  if (search.data.files.length > 0) return search.data.files[0].id;

  const requestBody = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) requestBody.parents = [parentId];

  const folder = await drive.files.create({ requestBody, fields: 'id' });
  return folder.data.id;
}

async function getCloudVaultFolderId(drive, accountId) {
  const cached = _folderCache.get(accountId);
  if (cached && cached.folderId) return cached.folderId;
  const folderId = await getOrCreateFolder(drive, 'CloudVault', null);
  _folderCache.set(accountId, { ...(_folderCache.get(accountId) || {}), folderId });
  return folderId;
}

async function getThumbnailsFolderId(drive, accountId) {
  const cached = _folderCache.get(accountId);
  if (cached && cached.thumbFolderId) return cached.thumbFolderId;
  const parentId = await getCloudVaultFolderId(drive, accountId);
  const thumbFolderId = await getOrCreateFolder(drive, 'thumbnails', parentId);
  _folderCache.set(accountId, { ...(_folderCache.get(accountId) || {}), thumbFolderId });
  return thumbFolderId;
}

// ── Public API ───────────────────────────────────────────────

function isConnected(accountId) {
  return getAuthedClient(accountId) !== null;
}

async function uploadFile(accountId, localPath, fileName, mimeType, isThumbnail = false) {
  const drive = await getDriveInstance(accountId);
  if (!drive) throw new Error('Google Drive not connected');

  const folderId = isThumbnail
    ? await getThumbnailsFolderId(drive, accountId)
    : await getCloudVaultFolderId(drive, accountId);

  const result = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: fs.createReadStream(localPath) },
    fields: 'id',
  });

  return result.data.id;
}

async function getFileStream(accountId, driveFileId) {
  const drive = await getDriveInstance(accountId);
  if (!drive) throw new Error('Google Drive not connected');

  const meta = await drive.files.get({ fileId: driveFileId, fields: 'mimeType, size, name' });
  const response = await drive.files.get({ fileId: driveFileId, alt: 'media' }, { responseType: 'stream' });

  return {
    stream: response.data,
    mimeType: meta.data.mimeType,
    size: parseInt(meta.data.size) || 0,
    name: meta.data.name,
  };
}

async function deleteFile(accountId, driveFileId) {
  const drive = await getDriveInstance(accountId);
  if (!drive) return;

  try {
    await drive.files.delete({ fileId: driveFileId });
  } catch (err) {
    if (err.code !== 404) console.error('Drive delete error:', err.message);
  }
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
  if (accountId) _folderCache.delete(accountId);
  else _folderCache.clear();
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
  saveAccountToken,
};
