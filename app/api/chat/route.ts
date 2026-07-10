import db from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { chatCompletion } from "@/lib/deepseek";
import { hasRealKey, reportUsage } from "@/lib/subscript";
import {
  FREE_MESSAGE_CAP,
  PRO_DAILY_CAP,
  PAYG_PRICE_USDC,
  DEV_VAULT_COMMIT_USDC,
} from "@/lib/plans";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const messages = db
    .prepare(
      "SELECT role, content, billed, created_at FROM messages WHERE user_id = ? ORDER BY id ASC LIMIT 200"
    )
    .all(user.id);
  return Response.json({ messages });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (!user.activated) {
    return Response.json(
      { error: "Pay the $1 activation fee to start chatting.", reason: "signup_fee" },
      { status: 402 }
    );
  }

  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  if (typeof message !== "string" || !message.trim() || message.length > 4000) {
    return Response.json({ error: "Message must be 1–4000 characters." }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const planActive =
    (user.plan === "pro" || user.plan === "promax") && (user.plan_expires_at ?? 0) > now;

  // Billing precedence: active plan -> pay-as-you-chat -> free trial cap.
  let billed: "plan" | "payg" | "free";
  if (planActive) {
    if (user.plan === "pro") {
      const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
      const today = (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND role = 'user' AND billed = 'plan' AND created_at >= ?"
          )
          .get(user.id, startOfDay) as { c: number }
      ).c;
      if (today >= PRO_DAILY_CAP) {
        return Response.json(
          {
            error: `Pro daily limit reached (${PRO_DAILY_CAP} messages). Upgrade to Pro Max for unlimited.`,
            reason: "pro_cap",
          },
          { status: 402 }
        );
      }
    }
    billed = "plan";
  } else if (user.payg_enabled && user.wallet_address) {
    // Pay-as-you-chat: $0.10 per message via SubScript metered vault.
    if (!hasRealKey()) {
      // Dev mode: simulate a $5 vault commit that exhausts at $5 accrued.
      const accrued = parseFloat(user.payg_accrued || "0") + parseFloat(PAYG_PRICE_USDC);
      if (accrued > DEV_VAULT_COMMIT_USDC) {
        return Response.json(
          {
            error: `Simulated vault exhausted (accrued $${(accrued - 0.1).toFixed(2)} of $${DEV_VAULT_COMMIT_USDC.toFixed(2)} commit). Re-fund your vault to continue.`,
            reason: "vault",
          },
          { status: 402 }
        );
      }
      db.prepare("UPDATE users SET payg_accrued = ? WHERE id = ?").run(
        accrued.toFixed(2),
        user.id
      );
    } else {
      const usage = await reportUsage(user.wallet_address, PAYG_PRICE_USDC);
      if (usage.status === 402) {
        return Response.json(
          {
            error: `Vault balance exhausted (owed $${usage.body?.owedUsdc ?? "?"}). Top up your SubScript vault to continue.`,
            reason: "vault",
            owedUsdc: usage.body?.owedUsdc,
          },
          { status: 402 }
        );
      }
      if (usage.status !== 200) {
        return Response.json(
          { error: `SubScript usage reporting failed (HTTP ${usage.status}).` },
          { status: 502 }
        );
      }
      db.prepare("UPDATE users SET payg_accrued = ? WHERE id = ?").run(
        String(usage.body?.accruedUsageUsdc ?? user.payg_accrued),
        user.id
      );
    }
    billed = "payg";
  } else {
    const freeUsed = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND role = 'user' AND billed = 'free'"
        )
        .get(user.id) as { c: number }
    ).c;
    if (freeUsed >= FREE_MESSAGE_CAP) {
      return Response.json(
        {
          error: `Free limit reached (${FREE_MESSAGE_CAP} messages). Upgrade to Pro, Pro Max, or enable pay-as-you-chat.`,
          reason: "free_cap",
        },
        { status: 402 }
      );
    }
    billed = "free";
  }

  db.prepare("INSERT INTO messages (user_id, role, content, billed) VALUES (?, 'user', ?, ?)").run(
    user.id,
    message.trim(),
    billed
  );

  const history = db
    .prepare(
      "SELECT role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 20"
    )
    .all(user.id)
    .reverse() as { role: "user" | "assistant"; content: string }[];

  let reply: string;
  try {
    reply = await chatCompletion(history);
  } catch (err) {
    reply = `Sorry — the AI backend returned an error: ${(err as Error).message}`;
  }

  db.prepare(
    "INSERT INTO messages (user_id, role, content, billed) VALUES (?, 'assistant', ?, NULL)"
  ).run(user.id, reply);

  return Response.json({ reply, billed });
}
