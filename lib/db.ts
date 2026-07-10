import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

function createDb() {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "app.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      activated INTEGER NOT NULL DEFAULT 0,
      plan TEXT NOT NULL DEFAULT 'free',
      plan_expires_at INTEGER,
      payg_enabled INTEGER NOT NULL DEFAULT 0,
      wallet_address TEXT,
      payg_accrued TEXT NOT NULL DEFAULT '0',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      billed TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product TEXT NOT NULL,
      amount_micros TEXT NOT NULL,
      intent_id TEXT,
      receipt_token TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      received_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, role, billed);
    CREATE INDEX IF NOT EXISTS idx_payments_intent ON payments(intent_id);
  `);
  return db;
}

// Reuse a single connection across Next.js dev hot reloads
const g = globalThis as unknown as { __krisDb?: Database.Database };
const db = g.__krisDb ?? createDb();
g.__krisDb = db;

export default db;
