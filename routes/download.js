const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const { queryOne, queryAll } = require('../db/database');
const s3Storage = require('../services/s3Storage');

// GET /api/download/:id - single file download (streamed from S3)
router.get('/:id', async (req, res) => {
  const row = queryOne('SELECT * FROM media WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.drive_file_id) return res.status(404).json({ error: 'File not in cloud storage' });

  try {
    const { stream, mimeType, size } = await s3Storage.getFileStream(row.drive_file_id);
    res.set('Content-Type', mimeType || row.mime_type);
    if (size) res.set('Content-Length', String(size));
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(row.original_name)}"`);
    stream.pipe(res);
  } catch (err) {
    console.error('Download stream error:', err.message);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// POST /api/download/zip - download multiple as ZIP (streamed from S3)
router.post('/zip', async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = queryAll(`SELECT * FROM media WHERE id IN (${placeholders})`, ids);

  if (rows.length === 0) {
    return res.status(404).json({ error: 'No files found' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="cloudvault-download.zip"');

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.pipe(res);

  for (const row of rows) {
    if (!row.drive_file_id) continue;
    try {
      const { stream } = await s3Storage.getFileStream(row.drive_file_id);
      const folder = (row.person_name || 'Unknown').replace(/[^a-zA-Z0-9 ]/g, '');
      archive.append(stream, { name: `${folder}/${row.original_name}` });
    } catch (err) {
      console.error(`ZIP: failed to fetch ${row.original_name}:`, err.message);
    }
  }

  archive.finalize();
});

// POST /api/download/zip-all - download all as ZIP (streamed from S3)
router.post('/zip-all', async (req, res) => {
  const { account_id } = req.body || {};
  let rows;
  if (account_id) {
    rows = queryAll('SELECT * FROM media WHERE account_id = ?', [account_id]);
  } else {
    rows = queryAll('SELECT * FROM media');
  }

  if (rows.length === 0) {
    return res.status(404).json({ error: 'No files found' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="cloudvault-all.zip"');

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.pipe(res);

  for (const row of rows) {
    if (!row.drive_file_id) continue;
    try {
      const { stream } = await s3Storage.getFileStream(row.drive_file_id);
      const folder = (row.person_name || 'Unknown').replace(/[^a-zA-Z0-9 ]/g, '');
      archive.append(stream, { name: `${folder}/${row.original_name}` });
    } catch (err) {
      console.error(`ZIP-all: failed to fetch ${row.original_name}:`, err.message);
    }
  }

  archive.finalize();
});

module.exports = router;
