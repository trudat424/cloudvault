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
