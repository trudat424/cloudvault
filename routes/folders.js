const express = require('express');
const router = express.Router();
const { queryAll, queryOne, run } = require('../db/database');

// Helper: extract accountId from X-Account-Id header or query param
function getAccountId(req) {
  return req.headers['x-account-id'] || req.query.account_id || null;
}

function getAccountRole(accountId) {
  if (!accountId) return null;
  const account = queryOne('SELECT role FROM accounts WHERE id = ?', [accountId]);
  return account ? account.role : null;
}

function mapFolderRow(row) {
  const sub = queryOne('SELECT COUNT(*) as count FROM folders WHERE parent_id = ?', [row.id]);
  const media = queryOne('SELECT COUNT(*) as count FROM media WHERE folder_id = ?', [row.id]);
  return {
    id: row.id,
    accountId: row.account_id,
    parentId: row.parent_id,
    name: row.name,
    createdAt: row.created_at,
    subfolderCount: sub ? sub.count : 0,
    mediaCount: media ? media.count : 0,
  };
}

// GET /api/folders - list folders at a level
router.get('/', (req, res) => {
  const { parent_id, account_id } = req.query;
  const requestAccountId = getAccountId(req);
  const role = getAccountRole(requestAccountId);

  let sql = 'SELECT * FROM folders WHERE 1=1';
  const params = [];

  // Parent filter
  if (parent_id) {
    sql += ' AND parent_id = ?';
    params.push(parent_id);
  } else {
    sql += ' AND parent_id IS NULL';
  }

  // Role-based visibility
  if (role === 'admin') {
    if (account_id) {
      sql += ' AND account_id = ?';
      params.push(account_id);
    }
  } else {
    sql += ' AND (account_id = ? OR account_id IN (SELECT owner_account_id FROM share_access WHERE viewer_account_id = ?))';
    params.push(requestAccountId, requestAccountId);
  }

  sql += ' ORDER BY name ASC';
  const rows = queryAll(sql, params);
  res.json(rows.map(mapFolderRow));
});

// GET /api/folders/:id - single folder with breadcrumb path
router.get('/:id', (req, res) => {
  const folder = queryOne('SELECT * FROM folders WHERE id = ?', [req.params.id]);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  // Build breadcrumb path by walking parent chain
  const path = [];
  let current = folder;
  while (current) {
    path.unshift({ id: current.id, name: current.name });
    if (current.parent_id) {
      current = queryOne('SELECT * FROM folders WHERE id = ?', [current.parent_id]);
    } else {
      current = null;
    }
  }

  res.json({ ...mapFolderRow(folder), path });
});

// POST /api/folders - create folder
router.post('/', (req, res) => {
  const { name, parent_id, account_id } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name is required' });
  if (!account_id) return res.status(400).json({ error: 'account_id is required' });

  // Role enforcement
  const role = getAccountRole(account_id);
  if (role === 'viewer') return res.status(403).json({ error: 'Viewers cannot create folders' });

  // Verify parent exists if provided
  if (parent_id) {
    const parent = queryOne('SELECT * FROM folders WHERE id = ?', [parent_id]);
    if (!parent) return res.status(404).json({ error: 'Parent folder not found' });
  }

  // Check for duplicate name in same parent
  const dupSql = parent_id
    ? 'SELECT id FROM folders WHERE account_id = ? AND parent_id = ? AND name = ?'
    : 'SELECT id FROM folders WHERE account_id = ? AND parent_id IS NULL AND name = ?';
  const dupParams = parent_id ? [account_id, parent_id, name.trim()] : [account_id, name.trim()];
  const dup = queryOne(dupSql, dupParams);
  if (dup) return res.status(409).json({ error: 'A folder with this name already exists here' });

  const id = 'fld_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  run(
    'INSERT INTO folders (id, account_id, parent_id, name) VALUES (?, ?, ?, ?)',
    [id, account_id, parent_id || null, name.trim()]
  );

  const folder = queryOne('SELECT * FROM folders WHERE id = ?', [id]);
  res.json(mapFolderRow(folder));
});

// PUT /api/folders/:id - rename folder
router.put('/:id', (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const folder = queryOne('SELECT * FROM folders WHERE id = ?', [req.params.id]);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  const accountId = getAccountId(req);
  const role = getAccountRole(accountId);
  if (role === 'viewer') return res.status(403).json({ error: 'Viewers cannot rename folders' });

  run('UPDATE folders SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
  const updated = queryOne('SELECT * FROM folders WHERE id = ?', [req.params.id]);
  res.json(mapFolderRow(updated));
});

// DELETE /api/folders/:id - delete folder
router.delete('/:id', (req, res) => {
  const folder = queryOne('SELECT * FROM folders WHERE id = ?', [req.params.id]);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  const accountId = getAccountId(req);
  const role = getAccountRole(accountId);
  if (role === 'viewer') return res.status(403).json({ error: 'Viewers cannot delete folders' });

  const action = req.query.action || 'move_to_parent';

  if (action === 'move_to_parent') {
    // Move all child media to parent folder
    run('UPDATE media SET folder_id = ? WHERE folder_id = ?', [folder.parent_id || null, folder.id]);
    // Move all child folders to parent
    run('UPDATE folders SET parent_id = ? WHERE parent_id = ?', [folder.parent_id || null, folder.id]);
  }
  // If action is 'delete_all', cascade will handle subfolders;
  // but we need to handle media explicitly since folder_id is not a real FK
  if (action === 'delete_all') {
    // Recursively collect all descendant folder IDs
    const allIds = [folder.id];
    let toCheck = [folder.id];
    while (toCheck.length > 0) {
      const placeholders = toCheck.map(() => '?').join(',');
      const children = queryAll(`SELECT id FROM folders WHERE parent_id IN (${placeholders})`, toCheck);
      toCheck = children.map(c => c.id);
      allIds.push(...toCheck);
    }
    // Delete media in all descendant folders
    const ph = allIds.map(() => '?').join(',');
    run(`UPDATE media SET folder_id = NULL WHERE folder_id IN (${ph})`, allIds);
    // Delete descendant folders (bottom up to avoid FK issues)
    for (let i = allIds.length - 1; i >= 0; i--) {
      run('DELETE FROM folders WHERE id = ?', [allIds[i]]);
    }
    return res.json({ success: true });
  }

  run('DELETE FROM folders WHERE id = ?', [folder.id]);
  res.json({ success: true });
});

// POST /api/folders/move - move items into a target folder
router.post('/move', (req, res) => {
  const { mediaIds, folderIds, targetFolderId } = req.body || {};
  const accountId = getAccountId(req);
  const role = getAccountRole(accountId);
  if (role === 'viewer') return res.status(403).json({ error: 'Viewers cannot move items' });

  const target = targetFolderId || null;

  // Verify target folder exists if not root
  if (target) {
    const targetFolder = queryOne('SELECT * FROM folders WHERE id = ?', [target]);
    if (!targetFolder) return res.status(404).json({ error: 'Target folder not found' });
  }

  let movedMedia = 0;
  let movedFolders = 0;

  if (mediaIds && mediaIds.length > 0) {
    const ph = mediaIds.map(() => '?').join(',');
    run(`UPDATE media SET folder_id = ? WHERE id IN (${ph})`, [target, ...mediaIds]);
    movedMedia = mediaIds.length;
  }

  if (folderIds && folderIds.length > 0) {
    // Prevent circular references
    if (target) {
      for (const fid of folderIds) {
        if (fid === target) {
          return res.status(400).json({ error: 'Cannot move a folder into itself' });
        }
        // Walk up from target to ensure fid is not an ancestor
        let check = queryOne('SELECT * FROM folders WHERE id = ?', [target]);
        while (check && check.parent_id) {
          if (check.parent_id === fid) {
            return res.status(400).json({ error: 'Cannot move a folder into its own descendant' });
          }
          check = queryOne('SELECT * FROM folders WHERE id = ?', [check.parent_id]);
        }
      }
    }

    const ph = folderIds.map(() => '?').join(',');
    run(`UPDATE folders SET parent_id = ? WHERE id IN (${ph})`, [target, ...folderIds]);
    movedFolders = folderIds.length;
  }

  res.json({ success: true, movedMedia, movedFolders });
});

module.exports = router;
