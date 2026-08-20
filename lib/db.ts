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
  commit_id TEXT,
  subscription_id TEXT,
  sub_checkout_id TEXT,
  sub_status TEXT,
  sub_alert TEXT,
  sub_cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  pending_display_name TEXT,
  created_at INTEGER NOT NULL DEFAULT (floor(extract(epoch from now()))::integer)
);
-- Additive migrations for databases created before subscriptions existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
-- A resume mints a NEW subscription id, so subscription_id is the current
-- authorization rather than a stable handle on the customer. The checkout
-- session is tracked separately: it is what payments.intent_id records at
-- creation, while only the on-chain subscription_id is accepted for cancel.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_checkout_id TEXT;
-- Standing advisory from the subscription lifecycle: 'allowance_low',
-- 'renewal_upcoming', 'trial_ending', 'payment_failed'. Cleared whenever the
-- subscription next activates, renews or resumes. allowance_low in particular
-- cannot be resolved by topping up USDC — the subscriber must re-authorize —
-- so it has to reach them rather than sit in a log.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_alert TEXT;
-- wallet_address used to hold EITHER a vault commit id or an on-chain address,
-- because report-usage accepts both. That conflation meant the subscribe path
-- could not tell whether it had an address to send as the subscriber, and since
-- the pay-as-you-chat setup asks for a Commit ID, it usually did not — so no
-- DM subscription offer was ever written. The two now have their own columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS commit_id TEXT;
-- Backfill, idempotent: moves any non-address value out of wallet_address and
-- never overwrites a commit_id that is already set. After it runs, no row has a
-- non-address in wallet_address, so later boots match nothing.
UPDATE users
   SET commit_id = COALESCE(commit_id, wallet_address),
       wallet_address = NULL
 WHERE wallet_address IS NOT NULL
   AND lower(wallet_address) NOT LIKE '0x%';
-- Paid display-name change: the requested name is parked in
-- pending_display_name until the $1 USDC payment is fulfilled.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_display_name TEXT;
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  thread_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  billed TEXT,
  created_at INTEGER NOT NULL DEFAULT (floor(extract(epoch from now()))::integer)
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_id TEXT;
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
  event_type TEXT,
  raw_body TEXT,
  processing_at INTEGER,
  processed_at INTEGER,
  error TEXT,
  received_at INTEGER NOT NULL DEFAULT (floor(extract(epoch from now()))::integer)
);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS raw_body TEXT;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processing_at INTEGER;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processed_at INTEGER;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS error TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, role, billed);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(user_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_payments_intent ON payments(intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_users_sub_id ON users(subscription_id);
CREATE INDEX IF NOT EXISTS idx_users_sub_checkout ON users(sub_checkout_id);
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
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
  if (process.env.VERCEL) {
    throw new Error(
      "DATABASE_URL is required on Vercel. Without a durable Postgres database, payment and chat state can disappear between serverless invocations."
    );
  }
  // No DATABASE_URL outside Vercel: embedded Postgres (PGlite), zero setup.
  // Persists to data/pglite locally.
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("fs");
  const dir = path.join(process.cwd(), "data", "pglite");
  // PGlite mkdirs its own directory but not the parent, so a checkout without
  // a data/ folder (it is gitignored, so every fresh clone) fails with ENOENT.
  mkdirSync(dir, { recursive: true });
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
  if (!g.__krisDb) {
    // Drop the cache if init rejects. Caching a rejected promise permanently
    // poisons the process: a transient Postgres failure at cold start would
    // make every later query on that instance fail with the original error,
    // long after the cause was gone.
    g.__krisDb = init().catch((err) => {
      g.__krisDb = undefined;
      throw err;
    });
  }
  return g.__krisDb;
}

export async function q(sql: string, params?: any[]): Promise<QueryResult> {
  return (await backend()).query(sql, params);
}

export async function one<T = Row>(sql: string, params?: any[]): Promise<T | undefined> {
  return (await q(sql, params)).rows[0] as T | undefined;
}
