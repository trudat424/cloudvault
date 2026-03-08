/**
 * S3-Compatible Storage Service
 * Handles all file upload/download/delete operations.
 * Works with AWS S3, Backblaze B2, Cloudflare R2, and any S3-compatible service.
 * Google Drive is only used for importing — this is the sole storage backend.
 */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION, S3_BUCKET_NAME, S3_ENDPOINT } = require('../config');

// ── S3 Client ────────────────────────────────────────

let _s3 = null;

function getS3Client() {
  if (_s3) return _s3;

  const config = {
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  };

  // Custom endpoint for S3-compatible services (Backblaze B2, Cloudflare R2, etc.)
  if (S3_ENDPOINT) {
    config.endpoint = S3_ENDPOINT;
    config.forcePathStyle = true; // R2 and most S3-compatible services use path style
  }

  _s3 = new S3Client(config);
  return _s3;
}

function isConfigured() {
  return !!(S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_BUCKET_NAME);
}

// ── Key helpers ──────────────────────────────────────

function buildKey(accountId, fileName, isThumbnail) {
  const folder = isThumbnail ? 'thumbnails' : 'originals';
  return `${accountId}/${folder}/${fileName}`;
}

// ── Public API ───────────────────────────────────────

/**
 * Upload a file to S3.
 * @returns {string} S3 object key (used as the file ID in the database)
 */
async function uploadFile(accountId, localPath, fileName, mimeType, isThumbnail = false) {
  const s3 = getS3Client();
  const key = buildKey(accountId, fileName, isThumbnail);

  const fileStream = fs.createReadStream(localPath);
  const fileStats = fs.statSync(localPath);

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Body: fileStream,
    ContentType: mimeType,
    ContentLength: fileStats.size,
  }));

  return key;
}

/**
 * Get a readable stream for a file from S3.
 * @param {string} s3Key — the S3 object key stored in drive_file_id / drive_thumb_id
 * @returns {{ stream, mimeType, size }}
 */
async function getFileStream(s3Key) {
  const s3 = getS3Client();

  const response = await s3.send(new GetObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: s3Key,
  }));

  return {
    stream: response.Body,
    mimeType: response.ContentType || 'application/octet-stream',
    size: response.ContentLength || 0,
  };
}

/**
 * Delete a file from S3.
 * @param {string} s3Key
 */
async function deleteFile(s3Key) {
  if (!s3Key) return;
  const s3 = getS3Client();

  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
    }));
  } catch (err) {
    // Ignore not-found errors
    if (err.name !== 'NoSuchKey') {
      console.error('S3 delete error:', err.message);
    }
  }
}

module.exports = {
  isConfigured,
  uploadFile,
  getFileStream,
  deleteFile,
};
