import { q } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("x-admin-key");
    const secret = process.env.ADMIN_RESET_SECRET || "kris-reset-secret";

    if (authHeader !== secret) {
      // Also allow if calling from same origin / authenticated request
      const origin = req.headers.get("origin") || "";
      const host = req.headers.get("host") || "";
      const referer = req.headers.get("referer") || "";
      const isInternal = referer.includes(host) || origin.includes(host);
      if (!isInternal && authHeader !== secret) {
        return Response.json({ error: "Unauthorized reset request." }, { status: 401 });
      }
    }

    await q("DELETE FROM messages;");
    await q("DELETE FROM payments;");
    await q("DELETE FROM webhook_events;");
    await q("DELETE FROM users;");

    return Response.json({ ok: true, message: "All user accounts, messages, payments, and webhooks reset successfully." });
  } catch (err: any) {
    return Response.json({ error: err.message || "Failed to reset database." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
