import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,                 -- sha256(token); the raw token lives only in the cookie
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    budget TEXT NOT NULL DEFAULT '',
    signup_deadline TEXT,
    exchange_date TEXT,
    shipping INTEGER NOT NULL DEFAULT 0,
    reveal_santas INTEGER NOT NULL DEFAULT 0,
    invite_token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'drawn', 'finished')),
    drawn_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE participants (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_enc TEXT,                    -- AES-GCM encrypted JSON profile
    profile_complete INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    UNIQUE (event_id, user_id)
  );
  CREATE TABLE exclusions (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    a INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    b INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, a, b),
    CHECK (a < b)
  );
  -- Only the giver is stored in clear text. The recipient is encrypted, so a
  -- database dump does not reveal who gives to whom.
  CREATE TABLE assignments (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    giver_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    recipient_enc TEXT NOT NULL,
    gift_status TEXT NOT NULL DEFAULT 'none' CHECK (gift_status IN ('none', 'making', 'ready', 'sent')),
    PRIMARY KEY (event_id, giver_id)
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    giver_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    from_santa INTEGER NOT NULL,
    body_enc TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX messages_thread ON messages(event_id, giver_id);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    public INTEGER NOT NULL DEFAULT 0,   -- visible to all participants of the event
    created_at INTEGER NOT NULL
  );
  CREATE INDEX audit_event ON audit_log(event_id, created_at);
  `,
  // v2: local meetups only – meeting place instead of shipping.
  `ALTER TABLE events ADD COLUMN location TEXT NOT NULL DEFAULT '';`,
];

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let i = version; i < MIGRATIONS.length; i++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
