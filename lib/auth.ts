import crypto from "crypto";
import { cookies } from "next/headers";
import { one } from "./db";

const SECRET = process.env.AUTH_SECRET || "kris-script-dev-secret";
const SESSION_TTL = 365 * 86400;

export type User = {
  id: number;
  email: string;
  password_hash: string;
  activated: number;
  plan: "free" | "pro" | "promax";
  plan_expires_at: number | null;
  payg_enabled: number;
  wallet_address: string | null;
  payg_accrued: string;
  subscription_id: string | null;
  sub_status: string | null;
  sub_cancel_at_period_end: number;
  created_at: number;
};

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), test);
}

function sign(value: string): string {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

export async function createSession(userId: number) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = `${userId}.${exp}`;
  (await cookies()).set("session", `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function destroySession() {
  (await cookies()).delete("session");
}

export async function currentUser(): Promise<User | null> {
  const raw = (await cookies()).get("session")?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const payload = `${uid}.${exp}`;
  const expected = sign(payload);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    return null;
  if (parseInt(exp, 10) < Date.now() / 1000) return null;
  const user = await one<User>("SELECT * FROM users WHERE id = $1", [Number(uid)]);
  return user ?? null;
}
