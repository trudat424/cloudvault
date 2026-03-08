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

  // Migration: add role column to accounts (admin|member|viewer)
  try { database.run("ALTER TABLE accounts ADD COLUMN role TEXT DEFAULT 'viewer'"); } catch(e) { /* exists */ }

  // Migration: add per-user Google Drive OAuth columns to accounts
  try { database.run("ALTER TABLE accounts ADD COLUMN gdrive_access_token TEXT"); } catch(e) { /* exists */ }
  try { database.run("ALTER TABLE accounts ADD COLUMN gdrive_refresh_token TEXT"); } catch(e) { /* exists */ }
  try { database.run("ALTER TABLE accounts ADD COLUMN gdrive_token_expiry TEXT"); } catch(e) { /* exists */ }
  try { database.run("ALTER TABLE accounts ADD COLUMN gdrive_email TEXT"); } catch(e) { /* exists */ }
  try { database.run("ALTER TABLE accounts ADD COLUMN gdrive_scope TEXT"); } catch(e) { /* exists */ }

  // Data migration: move global Drive tokens from settings → first user account
  const globalToken = database.exec("SELECT value FROM settings WHERE key = 'gdrive_access_token'");
  if (globalToken.length > 0 && globalToken[0].values.length > 0) {
    const firstUser = database.exec("SELECT id FROM accounts WHERE username IS NOT NULL LIMIT 1");
    if (firstUser.length > 0 && firstUser[0].values.length > 0) {
      const uid = firstUser[0].values[0][0];
      const getVal = (k) => {
        const r = database.exec(`SELECT value FROM settings WHERE key = '${k}'`);
        return r.length > 0 && r[0].values.length > 0 ? r[0].values[0][0] : null;
      };
      database.run(
        `UPDATE accounts SET gdrive_access_token = ?, gdrive_refresh_token = ?,
         gdrive_token_expiry = ?, gdrive_scope = ?, role = 'admin' WHERE id = ?`,
        [getVal('gdrive_access_token'), getVal('gdrive_refresh_token'),
         getVal('gdrive_token_expiry'), getVal('gdrive_scope'), uid]
      );
      database.run("DELETE FROM settings WHERE key IN ('gdrive_access_token','gdrive_refresh_token','gdrive_token_expiry','gdrive_connected','gdrive_scope')");
    }
  }

  // Data migration: reassign media from orphaned gdrive-type accounts to user accounts
  const gdriveAccounts = database.exec("SELECT id, email FROM accounts WHERE type = 'gdrive'");
  if (gdriveAccounts.length > 0) {
    for (const row of gdriveAccounts[0].values) {
      const [gdriveAccId, gdriveEmail] = row;
      // Find a user account that has this gdrive_email
      let match = database.exec(
        "SELECT id FROM accounts WHERE gdrive_email = ? AND username IS NOT NULL LIMIT 1",
        [gdriveEmail]
      );
      // Fallback: assign to first user account
      if (!match.length || !match[0].values.length) {
        match = database.exec("SELECT id FROM accounts WHERE username IS NOT NULL LIMIT 1");
      }
      if (match.length > 0 && match[0].values.length > 0) {
        const userAccId = match[0].values[0][0];
        database.run("UPDATE media SET account_id = ? WHERE account_id = ?", [userAccId, gdriveAccId]);
      }
      database.run("DELETE FROM accounts WHERE id = ?", [gdriveAccId]);
    }
  }

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
