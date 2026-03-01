const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const upload = require('../middleware/upload');
const { queryAll, queryOne, run } = require('../db/database');
const { generateThumbnail } = require('../services/thumbnail');
const { extractMetadata } = require('../services/metadata');
const { DATA_DIR } = require('../config');

// GET /api/media/stats - dashboard stats
router.get('/stats', (req, res) => {
  const rows = queryAll(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN type = 'photo' THEN 1 ELSE 0 END), 0) as photos,
      COALESCE(SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END), 0) as videos,
      COUNT(DISTINCT account_id) as people,
      COALESCE(SUM(size_bytes), 0) as totalBytes
    FROM media
  `);
  const stats = rows[0] || { total: 0, photos: 0, videos: 0, people: 0, totalBytes: 0 };
  res.json({
    total: stats.total,
    photos: stats.photos,
    videos: stats.videos,
    people: stats.people,
    totalGB: (stats.totalBytes / (1024 * 1024 * 1024)).toFixed(1),
  });
});

// GET /api/media/people - aggregated per-person stats
router.get('/people', (req, res) => {
  const rows = queryAll(`
    SELECT
      account_id,
      person_name,
      person_email,
      COALESCE(SUM(CASE WHEN type = 'photo' THEN 1 ELSE 0 END), 0) as photos,
      COALESCE(SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END), 0) as videos,
      COALESCE(SUM(size_bytes), 0) as totalBytes
    FROM media
    GROUP BY account_id
  `);
  res.json(rows.map(r => ({
    accountId: r.account_id,
    personName: r.person_name,
    personEmail: r.person_email,
    photos: r.photos,
    videos: r.videos,
    totalGB: (r.totalBytes / (1024 * 1024 * 1024)).toFixed(2),
  })));
});

// GET /api/media - list with filters
router.get('/', (req, res) => {
  const { type, account_id, sort, date, search, limit = 200, offset = 0 } = req.query;

  let sql = 'SELECT * FROM media WHERE 1=1';
  const params = [];

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

// POST /api/media/upload - upload files
router.post('/upload', upload.array('files', 20), async (req, res) => {
  const { account_id } = req.body;
  if (!account_id) return res.status(400).json({ error: 'account_id required' });

  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [account_id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const results = [];

  for (const file of req.files) {
    const id = path.basename(file.filename, path.extname(file.filename));
    const isVideo = file.mimetype.startsWith('video/');
    const type = isVideo ? 'video' : 'photo';

    // Extract metadata for images
    let meta = {};
    if (!isVideo) {
      meta = await extractMetadata(file.path);
    }

    // Generate thumbnail for images
    let hasThumbnail = 0;
    if (!isVideo) {
      const thumbPath = path.join(DATA_DIR, 'uploads', 'thumbnails', id + '.jpg');
      hasThumbnail = (await generateThumbnail(file.path, thumbPath)) ? 1 : 0;
    }

    run(
      `INSERT INTO media (id, account_id, person_name, person_email, type,
        original_name, stored_name, mime_type, size_bytes,
        width, height, date_taken, latitude, longitude,
        camera_make, camera_model, has_thumbnail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, account_id, account.name, account.email, type,
        file.originalname, file.filename, file.mimetype, file.size,
        meta.width || null, meta.height || null,
        meta.dateTaken || new Date().toISOString(),
        meta.latitude || null, meta.longitude || null,
        meta.cameraMake || null, meta.cameraModel || null,
        hasThumbnail,
      ]
    );

    const row = queryOne('SELECT * FROM media WHERE id = ?', [id]);
    results.push(mapMediaRow(row));
  }

  res.json({ media: results, count: results.length });
});

// DELETE /api/media/:id - delete single
router.delete('/:id', (req, res) => {
  const row = queryOne('SELECT * FROM media WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Delete files from disk
  const origPath = path.join(DATA_DIR, 'uploads', 'originals', row.stored_name);
  const thumbPath = path.join(DATA_DIR, 'uploads', 'thumbnails',
    path.basename(row.stored_name, path.extname(row.stored_name)) + '.jpg');

  try { fs.unlinkSync(origPath); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }

  run('DELETE FROM media WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

function mapMediaRow(row) {
  const id = row.id;
  const ext = path.extname(row.stored_name);
  const thumbName = id + '.jpg';
  return {
    id,
    accountId: row.account_id,
    personId: row.account_id,
    personName: row.person_name,
    personEmail: row.person_email,
    icloudName: row.person_email,
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
    thumbnail: row.has_thumbnail ? `/uploads/thumbnails/${thumbName}` : null,
    original: `/uploads/originals/${row.stored_name}`,
  };
}

module.exports = router;
