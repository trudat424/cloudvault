CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  username    TEXT UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'icloud',
  password    TEXT DEFAULT NULL,
  connected_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  person_name   TEXT NOT NULL,
  person_email  TEXT NOT NULL,
  type          TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  duration      REAL,
  date_taken    TEXT,
  latitude      REAL,
  longitude     REAL,
  location      TEXT DEFAULT '',
  camera_make   TEXT,
  camera_model  TEXT,
  category      TEXT DEFAULT '',
  has_thumbnail INTEGER DEFAULT 0,
  source_id     TEXT,
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS transfer_history (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  description TEXT NOT NULL,
  file_count  INTEGER DEFAULT 0,
  size_bytes  INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'complete',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS share_links (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  label       TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS share_access (
  id                TEXT PRIMARY KEY,
  owner_account_id  TEXT NOT NULL,
  viewer_account_id TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (viewer_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_account ON media(account_id);
CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
CREATE INDEX IF NOT EXISTS idx_media_uploaded ON media(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_media_date_taken ON media(date_taken);
CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_account ON share_links(account_id);
CREATE INDEX IF NOT EXISTS idx_share_access_owner ON share_access(owner_account_id);
CREATE INDEX IF NOT EXISTS idx_share_access_viewer ON share_access(viewer_account_id);
