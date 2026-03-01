const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { queryOne, queryAll } = require('../db/database');
const { DATA_DIR } = require('../config');

// GET /api/download/:id - single file download
router.get('/:id', (req, res) => {
  const row = queryOne('SELECT * FROM media WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(DATA_DIR, 'uploads', 'originals', row.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(filePath, row.original_name);
});

// POST /api/download/zip - download multiple as ZIP
router.post('/zip', (req, res) => {
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
    const filePath = path.join(DATA_DIR, 'uploads', 'originals', row.stored_name);
    if (fs.existsSync(filePath)) {
      // Organize by person name in the ZIP
      const folder = row.person_name.replace(/[^a-zA-Z0-9 ]/g, '');
      archive.file(filePath, { name: `${folder}/${row.original_name}` });
    }
  }

  archive.finalize();
});

// POST /api/download/zip-all - download all as ZIP
router.post('/zip-all', (req, res) => {
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
    const filePath = path.join(DATA_DIR, 'uploads', 'originals', row.stored_name);
    if (fs.existsSync(filePath)) {
      const folder = row.person_name.replace(/[^a-zA-Z0-9 ]/g, '');
      archive.file(filePath, { name: `${folder}/${row.original_name}` });
    }
  }

  archive.finalize();
});

module.exports = router;
