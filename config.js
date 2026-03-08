const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3456/api/gdrive/callback';
const STORAGE_LIMIT_GB = parseInt(process.env.STORAGE_LIMIT_GB) || 15;
module.exports = { DATA_DIR, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, STORAGE_LIMIT_GB };
