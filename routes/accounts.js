const express = require('express');
const router = express.Router();
const { queryAll, queryOne, run } = require('../db/database');

// GET /api/accounts - list all
router.get('/', (req, res) => {
  const accounts = queryAll('SELECT * FROM accounts ORDER BY connected_at DESC');
  res.json(accounts.map(mapAccount));
});

// POST /api/accounts/signup - create account with username + password
router.post('/signup', (req, res) => {
  let { username, password, name } = req.body || {};

  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }
  if (!password || !password.trim()) {
    return res.status(400).json({ error: 'Password is required' });
  }

  username = username.trim().toLowerCase();
  password = password.trim();
  name = (name && name.trim()) || username;

  // Check if username already exists
  const existing = queryOne('SELECT * FROM accounts WHERE username = ?', [username]);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const id = 'acc_' + Date.now();
  const connectedAt = new Date().toISOString();
  const email = username + '@cloudvault.local';

  run(
    'INSERT INTO accounts (id, name, username, email, type, password, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, name, username, email, 'icloud', password, connectedAt]
  );

  const account = queryOne('SELECT * FROM accounts WHERE id = ?', [id]);
  res.json(mapAccount(account));
});

// POST /api/accounts/login - login with username + password
router.post('/login', (req, res) => {
  let { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  username = username.trim().toLowerCase();
  password = password.trim();

  const account = queryOne('SELECT * FROM accounts WHERE username = ?', [username]);
  if (!account) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (account.password !== password) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  res.json(mapAccount(account));
});

// POST /api/accounts - create account with real identity (legacy, used by admin)
router.post('/', (req, res) => {
  let { name, email } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  name = name.trim();
  if (!email || !email.trim()) {
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

// GET /api/accounts/search?q=username - search users for sharing
router.get('/search', (req, res) => {
  const q = req.query.q;
  if (!q || q.trim().length < 1) {
    return res.json([]);
  }
  const pattern = `%${q.trim().toLowerCase()}%`;
  const accounts = queryAll(
    'SELECT * FROM accounts WHERE (username LIKE ? OR name LIKE ?) AND username IS NOT NULL LIMIT 10',
    [pattern, pattern]
  );
  res.json(accounts.map(a => ({ id: a.id, name: a.name, username: a.username })));
});

function mapAccount(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username || null,
    email: row.email,
    type: row.type,
    hasPassword: !!row.password,
    connectedAt: row.connected_at,
  };
}

module.exports = router;
