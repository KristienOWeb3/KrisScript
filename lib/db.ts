import path from "path";

type Row = Record<string, any>;
export type QueryResult = { rows: Row[]; rowCount: number };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  activated INTEGER NOT NULL DEFAULT 0,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_at INTEGER,
  payg_enabled INTEGER NOT NULL DEFAULT 0,
  wallet_address TEXT,
  payg_accrued TEXT NOT NULL DEFAULT '0',
  created_at INTEGER NOT NULL DEFAULT (floor(extract(epoch from now()))::integer)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  billed TEXT,
  created_at INTEGER NOT NULL DEFAULT (floor(extract(epoch from now()))::integer)
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  product TEXT NOT NULL,
  amount_micros TEXT NOT NULL,
  intent_id TEXT,
  receipt_token TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at INTEGER NOT NULL DEFAULT (floor(extract(epoch from now()))::integer)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL DEFAULT (floor(extract(epoch from now()))::integer)
);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, role, billed);
CREATE INDEX IF NOT EXISTS idx_payments_intent ON payments(intent_id);
`;

interface Backend {
  query(sql: string, params?: any[]): Promise<QueryResult>;
}

async function init(): Promise<Backend> {
  if (process.env.DATABASE_URL) {
    // Production: any Postgres (Neon, Supabase, RDS…) via connection string.
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    await pool.query(SCHEMA);
    return {
      query: async (sql, params) => {
        const r = await pool.query(sql, params);
        return { rows: r.rows, rowCount: r.rowCount ?? 0 };
      },
    };
  }
  // No DATABASE_URL: embedded Postgres (PGlite), zero setup. Persists to
  // data/pglite locally; on Vercel it falls back to ephemeral /tmp storage,
  // so set DATABASE_URL there for anything real.
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.VERCEL
    ? "/tmp/kris-script-pglite"
    : path.join(process.cwd(), "data", "pglite");
  const db = new PGlite(dir);
  await db.exec(SCHEMA);
  return {
    query: async (sql, params) => {
      const r = await db.query(sql, params ?? []);
      return {
        rows: r.rows as Row[],
        rowCount: (r as any).affectedRows ?? r.rows.length,
      };
    },
  };
}

// Cache the backend promise across dev hot reloads and warm invocations.
const g = globalThis as unknown as { __krisDb?: Promise<Backend> };
function backend(): Promise<Backend> {
  if (!g.__krisDb) g.__krisDb = init();
  return g.__krisDb;
}

export async function q(sql: string, params?: any[]): Promise<QueryResult> {
  return (await backend()).query(sql, params);
}

export async function one<T = Row>(sql: string, params?: any[]): Promise<T | undefined> {
  return (await q(sql, params)).rows[0] as T | undefined;
}
