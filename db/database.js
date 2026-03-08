const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('../config');

const DB_PATH = path.join(DATA_DIR, 'cloudvault.db');
let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

async function initDatabase() {
  const database = await getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  database.run(schema);

  // Migration: add source_id column if missing
  try { database.run("ALTER TABLE media ADD COLUMN source_id TEXT"); } catch(e) { /* column already exists */ }

  // Migration: add Google Drive file ID columns
  try { database.run("ALTER TABLE media ADD COLUMN drive_file_id TEXT"); } catch(e) { /* column already exists */ }
  try { database.run("ALTER TABLE media ADD COLUMN drive_thumb_id TEXT"); } catch(e) { /* column already exists */ }

  // Migration: add password column to accounts for per-user viewing password
  try { database.run("ALTER TABLE accounts ADD COLUMN password TEXT DEFAULT NULL"); } catch(e) { /* column already exists */ }

  // Migration: add username column to accounts
  try { database.run("ALTER TABLE accounts ADD COLUMN username TEXT"); } catch(e) { /* column already exists */ }
  // Create unique index on username (if not exists)
  try { database.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username) WHERE username IS NOT NULL"); } catch(e) { /* index already exists */ }

  // Seed admin password if not set
  const result = database.exec("SELECT value FROM settings WHERE key = 'admin_password'");
  if (result.length === 0) {
    database.run('INSERT INTO settings (key, value) VALUES (?, ?)',
      ['admin_password', process.env.ADMIN_PASSWORD || 'bob123']);
  }

  saveDb();
}

// Helper: run a query that returns rows
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run a query that returns one row
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run an INSERT/UPDATE/DELETE
function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

module.exports = { getDb, saveDb, initDatabase, queryAll, queryOne, run };
