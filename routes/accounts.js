const express = require('express');
const router = express.Router();
const { queryAll, queryOne, run } = require('../db/database');

// GET /api/accounts - list all
router.get('/', (req, res) => {
  const accounts = queryAll('SELECT * FROM accounts ORDER BY connected_at DESC');
  res.json(accounts.map(mapAccount));
});

// POST /api/accounts - create account with real identity
router.post('/', (req, res) => {
  let { name, email } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  name = name.trim();
  if (!email || !email.trim()) {
    // Auto-generate email from name
    email = name.toLowerCase().replace(/\s+/g, '.') + '@imported.local';
  } else {
    email = email.trim();
  }

  // Check if already connected — reuse existing account
  const existing = queryOne('SELECT * FROM accounts WHERE email = ?', [email]);
  if (existing) {
    return res.json(mapAccount(existing));
  }

  const id = 'acc_' + Date.now();
  const connectedAt = new Date().toISOString();

  run(
    'INSERT INTO accounts (id, name, email, type, connected_at) VALUES (?, ?, ?, ?, ?)',
    [id, name, email, 'icloud', connectedAt]
  );

  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [id]);
  res.json(mapAccount(account));
});

// DELETE /api/accounts/:id
router.delete('/:id', (req, res) => {
  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  run('DELETE FROM accounts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// POST /api/accounts/:id/password — set, update, or remove viewing password
router.post('/:id/password', (req, res) => {
  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const { password } = req.body || {};

  if (!password || !password.trim()) {
    // Remove password protection
    run('UPDATE accounts SET password = NULL WHERE id = ?', [req.params.id]);
    return res.json({ success: true, hasPassword: false });
  }

  run('UPDATE accounts SET password = ? WHERE id = ?', [password.trim(), req.params.id]);
  res.json({ success: true, hasPassword: true });
});

// POST /api/accounts/:id/verify-password — check viewing password
router.post('/:id/verify-password', (req, res) => {
  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // No password set — always allow
  if (!account.password) {
    return res.json({ success: true });
  }

  const { password } = req.body || {};
  if (password === account.password) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Incorrect password' });
  }
});

function mapAccount(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    type: row.type,
    hasPassword: !!row.password,
    connectedAt: row.connected_at,
  };
}

module.exports = router;
