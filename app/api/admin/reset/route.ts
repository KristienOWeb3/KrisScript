import crypto from "crypto";
import { q } from "@/lib/db";

/**
 * Destructive: empties users, messages, payments and webhook_events.
 *
 * Previously this was effectively public. The x-admin-key check fell through
 * to `referer.includes(host) || origin.includes(host)`, which any caller can
 * forge; it was also exported as GET, so an <img src>, a prefetch, a crawler
 * or simply typing the URL after visiting the site would wipe the database;
 * and the secret defaulted to a literal committed to a public repo.
 *
 * Now: POST only, and a timing-safe match against ADMIN_RESET_SECRET, which
 * must be explicitly configured. No fallback secret, no same-origin bypass.
 */
function authorized(req: Request): boolean {
  const secret = process.env.ADMIN_RESET_SECRET;
  // Unset means the endpoint is disabled, not that anything goes.
  if (!secret) return false;

  const provided = req.headers.get("x-admin-key");
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return Response.json(
      {
        error:
          "Unauthorized. Set ADMIN_RESET_SECRET and send it as the x-admin-key header.",
      },
      { status: 401 }
    );
  }

  try {
    // RESTART IDENTITY so a relaunch starts ids from 1 rather than continuing
    // the old sequence. Single statement, so it is all-or-nothing.
    await q(
      "TRUNCATE TABLE messages, payments, webhook_events, users RESTART IDENTITY CASCADE;"
    );
    return Response.json({
      ok: true,
      message: "All user accounts, messages, payments, and webhooks reset.",
    });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Failed to reset database." },
      { status: 500 }
    );
  }
}
