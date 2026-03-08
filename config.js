const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3456/api/gdrive/callback';
const STORAGE_LIMIT_GB = parseInt(process.env.STORAGE_LIMIT_GB) || 15;

// S3-compatible storage (AWS S3, Backblaze B2, Cloudflare R2, etc.)
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-west-004';
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || '';
const S3_ENDPOINT = process.env.S3_ENDPOINT || ''; // e.g. https://s3.us-west-004.backblazeb2.com

module.exports = {
  DATA_DIR, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, STORAGE_LIMIT_GB,
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION, S3_BUCKET_NAME, S3_ENDPOINT,
};
