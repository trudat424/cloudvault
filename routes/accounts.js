const express = require('express');
const router = express.Router();
const { queryAll, queryOne, run } = require('../db/database');

const SIMULATED_ACCOUNTS = [
  { email: 'sarah.m@icloud.com', name: 'Sarah Mitchell' },
  { email: 'jake.rod@icloud.com', name: 'Jake Rodriguez' },
  { email: 'emma.chen@icloud.com', name: 'Emma Chen' },
  { email: 'marcus.j@icloud.com', name: 'Marcus Johnson' },
  { email: 'olivia.w@icloud.com', name: 'Olivia Williams' },
  { email: 'noah.k@icloud.com', name: 'Noah Kim' },
];

// GET /api/accounts - list all
router.get('/', (req, res) => {
  const accounts = queryAll('SELECT * FROM accounts ORDER BY connected_at DESC');
  res.json(accounts.map(mapAccount));
});

// POST /api/accounts - create (simulated connect)
router.post('/', (req, res) => {
  let { name, email } = req.body || {};

  // If no name/email provided, pick a random simulated account
  if (!name || !email) {
    const connected = queryAll('SELECT email FROM accounts');
    const connectedEmails = connected.map(a => a.email);
    const available = SIMULATED_ACCOUNTS.filter(a => !connectedEmails.includes(a.email));

    if (available.length === 0) {
      // Generate a new random one
      const num = Date.now() % 1000;
      name = `User ${num}`;
      email = `user${num}@icloud.com`;
    } else {
      const pick = available[Math.floor(Math.random() * available.length)];
      name = pick.name;
      email = pick.email;
    }
  }

  // Check if already connected
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

function mapAccount(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    type: row.type,
    connectedAt: row.connected_at,
  };
}

module.exports = router;
