require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { initDatabase } = require('./db/database');
const { DATA_DIR } = require('./config');

const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/media', require('./routes/media'));
app.use('/api/download', require('./routes/download'));
app.use('/api/gdrive', require('./routes/gdrive'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/share', require('./routes/share'));

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
async function start() {
  await initDatabase();

  app.listen(PORT, () => {
    console.log(`CloudVault running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
