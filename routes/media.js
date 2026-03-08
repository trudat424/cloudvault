const express = require('express');
const router = express.Router();
const path = require('path');
const os = require('os');
const fs = require('fs');
const upload = require('../middleware/upload');
const { queryAll, queryOne, run } = require('../db/database');
const { generateThumbnail } = require('../services/thumbnail');
const { extractMetadata } = require('../services/metadata');
const { STORAGE_LIMIT_GB } = require('../config');
const s3Storage = require('../services/s3Storage');

// Helper: extract accountId from X-Account-Id header or query param
function getAccountId(req) {
  return req.headers['x-account-id'] || req.query.account_id || null;
}

// Helper: look up the account's role from the database
function getAccountRole(accountId) {
  if (!accountId) return null;
  const account = queryOne('SELECT role FROM accounts WHERE id = ?', [accountId]);
  return account ? account.role : null;
}

// GET /api/media/stats - dashboard stats (filtered by role)
router.get('/stats', (req, res) => {
  const accountId = getAccountId(req);
  const role = getAccountRole(accountId);

  let sql;
  let params = [];

  if (role === 'admin') {
    // Admin sees aggregate of all media
    sql = `
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN type = 'photo' THEN 1 ELSE 0 END), 0) as photos,
        COALESCE(SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END), 0) as videos,
        COUNT(DISTINCT account_id) as people,
        COALESCE(SUM(size_bytes), 0) as totalBytes
      FROM media
    `;
  } else {
    // Member/Viewer: own media + shared media
    sql = `
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN type = 'photo' THEN 1 ELSE 0 END), 0) as photos,
        COALESCE(SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END), 0) as videos,
        COUNT(DISTINCT account_id) as people,
        COALESCE(SUM(size_bytes), 0) as totalBytes
      FROM media
      WHERE account_id = ? OR account_id IN (SELECT owner_account_id FROM share_access WHERE viewer_account_id = ?)
    `;
    params = [accountId, accountId];
  }

  const rows = queryAll(sql, params);
  const stats = rows[0] || { total: 0, photos: 0, videos: 0, people: 0, totalBytes: 0 };
  res.json({
    total: stats.total,
    photos: stats.photos,
    videos: stats.videos,
    people: stats.people,
    totalGB: (stats.totalBytes / (1024 * 1024 * 1024)).toFixed(1),
    storageLimitGB: STORAGE_LIMIT_GB,
  });
});

// GET /api/media/people - aggregated per-person stats (filtered by role)
router.get('/people', (req, res) => {
  const accountId = getAccountId(req);
  const role = getAccountRole(accountId);

  let sql;
  let params = [];

  if (role === 'admin') {
    // Admin sees all people
    sql = `
      SELECT
        account_id,
        person_name,
        person_email,
        COALESCE(SUM(CASE WHEN type = 'photo' THEN 1 ELSE 0 END), 0) as photos,
        COALESCE(SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END), 0) as videos,
        COALESCE(SUM(size_bytes), 0) as totalBytes
      FROM media
      GROUP BY account_id
    `;
  } else {
    // Member/Viewer: own + shared
    sql = `
      SELECT
        account_id,
        person_name,
        person_email,
        COALESCE(SUM(CASE WHEN type = 'photo' THEN 1 ELSE 0 END), 0) as photos,
        COALESCE(SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END), 0) as videos,
        COALESCE(SUM(size_bytes), 0) as totalBytes
      FROM media
      WHERE account_id = ? OR account_id IN (SELECT owner_account_id FROM share_access WHERE viewer_account_id = ?)
      GROUP BY account_id
    `;
    params = [accountId, accountId];
  }

  const rows = queryAll(sql, params);
  res.json(rows.map(r => ({
    accountId: r.account_id,
    personName: r.person_name,
    personEmail: r.person_email,
    photos: r.photos,
    videos: r.videos,
    totalGB: (r.totalBytes / (1024 * 1024 * 1024)).toFixed(2),
  })));
});

// GET /api/media/file/:id - stream original from S3
router.get('/file/:id', async (req, res) => {
  const row = queryOne('SELECT * FROM media WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.drive_file_id) return res.status(404).json({ error: 'File not in cloud storage' });

  try {
    const { stream, mimeType, size } = await s3Storage.getFileStream(row.drive_file_id);
    res.set('Content-Type', mimeType || row.mime_type);
    if (size) res.set('Content-Length', String(size));
    res.set('Cache-Control', 'public, max-age=86400');
    stream.pipe(res);
  } catch (err) {
    console.error('S3 file stream error:', err.message);
    res.status(500).json({ error: 'Failed to load file' });
  }
});

// GET /api/media/thumb/:id - stream thumbnail from S3
router.get('/thumb/:id', async (req, res) => {
  const row = queryOne('SELECT * FROM media WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.drive_thumb_id) return res.status(404).json({ error: 'Thumbnail not available' });

  try {
    const { stream } = await s3Storage.getFileStream(row.drive_thumb_id);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=604800');
    stream.pipe(res);
  } catch (err) {
    console.error('S3 thumb stream error:', err.message);
    res.status(500).json({ error: 'Failed to load thumbnail' });
  }
});

// GET /api/media - list with filters (server-side filtering by role)
router.get('/', (req, res) => {
  const { type, account_id, sort, date, search, limit = 200, offset = 0 } = req.query;

  const requestAccountId = getAccountId(req);
  const role = getAccountRole(requestAccountId);

  let sql = 'SELECT * FROM media WHERE 1=1';
  const params = [];

  // Role-based visibility filter
  if (role === 'admin') {
    // Admin sees everything - no account_id filter applied automatically
  } else {
    // Member/Viewer: own media + media shared via share_access
    sql += ' AND (account_id = ? OR account_id IN (SELECT owner_account_id FROM share_access WHERE viewer_account_id = ?))';
    params.push(requestAccountId, requestAccountId);
  }

  if (type && type !== 'all') {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (account_id && account_id !== 'all') {
    sql += ' AND account_id = ?';
    params.push(account_id);
  }
  if (search) {
    sql += ' AND (original_name LIKE ? OR person_name LIKE ? OR location LIKE ? OR category LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (date && date !== 'all') {
    const days = { today: 1, week: 7, month: 30, year: 365 };
    if (days[date]) {
      sql += ` AND uploaded_at >= datetime('now', '-${days[date]} days')`;
    }
  }

  const sortMap = {
    newest: 'uploaded_at DESC',
    oldest: 'uploaded_at ASC',
    largest: 'size_bytes DESC',
    smallest: 'size_bytes ASC',
    name: 'original_name ASC',
  };
  sql += ` ORDER BY ${sortMap[sort] || sortMap.newest}`;
  sql += ` LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

  const rows = queryAll(sql, params);
  res.json(rows.map(mapMediaRow));
});

// GET /api/media/:id - single item
router.get('/:id', (req, res) => {
  const row = queryOne('SELECT * FROM media WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(mapMediaRow(row));
});

// POST /api/media/upload - upload files to S3 (role enforcement)
router.post('/upload', upload.array('files', 20), async (req, res) => {
  const { account_id } = req.body;
  if (!account_id) return res.status(400).json({ error: 'account_id required' });

  // Role enforcement: viewers cannot upload
  const role = getAccountRole(account_id);
  if (role === 'viewer') {
    for (const file of req.files) {
      try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
    }
    return res.status(403).json({ error: 'Viewers cannot upload' });
  }

  if (!s3Storage.isConfigured()) {
    for (const file of req.files) {
      try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
    }
    return res.status(500).json({ error: 'S3 storage is not configured' });
  }

  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [account_id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const results = [];
  const tmpDir = path.join(os.tmpdir(), 'cloudvault-uploads');

  for (const file of req.files) {
    const id = path.basename(file.filename, path.extname(file.filename));
    const isVideo = file.mimetype.startsWith('video/');
    const type = isVideo ? 'video' : 'photo';

    try {
      // Extract metadata for images
      let meta = {};
      if (!isVideo) {
        meta = await extractMetadata(file.path);
      }

      // Upload original to S3
      const s3FileKey = await s3Storage.uploadFile(account_id, file.path, file.originalname, file.mimetype, false);

      // Generate + upload thumbnail for images
      let hasThumbnail = 0;
      let s3ThumbKey = null;
      if (!isVideo) {
        const thumbPath = path.join(tmpDir, id + '_thumb.jpg');
        hasThumbnail = (await generateThumbnail(file.path, thumbPath)) ? 1 : 0;
        if (hasThumbnail) {
          s3ThumbKey = await s3Storage.uploadFile(account_id, thumbPath, id + '.jpg', 'image/jpeg', true);
          try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }
        }
      }

      // Clean up temp original
      try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }

      run(
        `INSERT INTO media (id, account_id, person_name, person_email, type,
          original_name, stored_name, mime_type, size_bytes,
          width, height, date_taken, latitude, longitude,
          camera_make, camera_model, has_thumbnail,
          drive_file_id, drive_thumb_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, account_id, account.name, account.email, type,
          file.originalname, file.filename, file.mimetype, file.size,
          meta.width || null, meta.height || null,
          meta.dateTaken || new Date().toISOString(),
          meta.latitude || null, meta.longitude || null,
          meta.cameraMake || null, meta.cameraModel || null,
          hasThumbnail,
          s3FileKey, s3ThumbKey,
        ]
      );

      const row = queryOne('SELECT * FROM media WHERE id = ?', [id]);
      results.push(mapMediaRow(row));
    } catch (err) {
      console.error(`Upload failed for ${file.originalname}:`, err.message);
      try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
    }
  }

  res.json({ media: results, count: results.length });
});

// DELETE /api/media/:id - delete single (role enforcement)
router.delete('/:id', async (req, res) => {
  const row = queryOne('SELECT * FROM media WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Role enforcement: viewers cannot delete
  const accountId = getAccountId(req);
  const role = getAccountRole(accountId);
  if (role === 'viewer') {
    return res.status(403).json({ error: 'Viewers cannot delete' });
  }

  // Delete files from S3
  if (row.drive_file_id) await s3Storage.deleteFile(row.drive_file_id);
  if (row.drive_thumb_id) await s3Storage.deleteFile(row.drive_thumb_id);

  run('DELETE FROM media WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

function mapMediaRow(row) {
  const id = row.id;
  return {
    id,
    accountId: row.account_id,
    personId: row.account_id,
    personName: row.person_name,
    personEmail: row.person_email,
    type: row.type,
    name: row.original_name,
    sizeMB: parseFloat((row.size_bytes / (1024 * 1024)).toFixed(1)),
    sizeBytes: row.size_bytes,
    resolution: row.width && row.height ? `${row.width}x${row.height}` : '',
    width: row.width,
    height: row.height,
    date: row.date_taken || row.uploaded_at,
    timestamp: new Date(row.date_taken || row.uploaded_at).getTime(),
    dateTaken: row.date_taken,
    uploadedAt: row.uploaded_at,
    location: row.location || '',
    latitude: row.latitude,
    longitude: row.longitude,
    cameraMake: row.camera_make,
    cameraModel: row.camera_model,
    category: row.category || '',
    duration: row.duration,
    has_thumbnail: row.has_thumbnail,
    thumbnail: row.drive_thumb_id ? `/api/media/thumb/${id}` : null,
    original: row.drive_file_id ? `/api/media/file/${id}` : null,
  };
}

module.exports = router;
