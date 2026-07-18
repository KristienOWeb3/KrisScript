import crypto from "crypto";
import { q, one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { chatCompletion } from "@/lib/deepseek";
import { hasRealKey, reportUsage } from "@/lib/subscript";
import {
  FREE_MESSAGE_CAP,
  PRO_DAILY_CAP,
  PAYG_PRICE_USDC,
  PAYG_PRICE_USDC_MICROS,
  DEV_VAULT_COMMIT_USDC,
} from "@/lib/plans";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { rows: messages } = await q(
    "SELECT role, content, billed, created_at FROM messages WHERE user_id = $1 ORDER BY id ASC LIMIT 200",
    [user.id]
  );
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
  // This block only reserves the billing path. Quota / PAYG is consumed after
  // DeepSeek succeeds so failed AI calls do not charge the user.
  let billed: "plan" | "payg" | "free";
  let nextDevPaygAccrued: string | null = null;
  if (planActive) {
    if (user.plan === "pro") {
      const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
      const today = await one<{ c: number }>(
        "SELECT COUNT(*)::int AS c FROM messages WHERE user_id = $1 AND role = 'user' AND billed = 'plan' AND created_at >= $2",
        [user.id, startOfDay]
      );
      if ((today?.c ?? 0) >= PRO_DAILY_CAP) {
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
      nextDevPaygAccrued = accrued.toFixed(2);
    }
    billed = "payg";
  } else {
    const freeUsed = await one<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM messages WHERE user_id = $1 AND role = 'user' AND billed = 'free'",
      [user.id]
    );
    if ((freeUsed?.c ?? 0) >= FREE_MESSAGE_CAP) {
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

  const { rows: recent } = await q(
    "SELECT role, content FROM messages WHERE user_id = $1 ORDER BY id DESC LIMIT 20",
    [user.id]
  );
  const history = [
    ...(recent.reverse() as { role: "user" | "assistant"; content: string }[]),
    { role: "user" as const, content: message.trim() },
  ];

  let reply: string;
  try {
    reply = await chatCompletion(history);
  } catch (err) {
    return Response.json(
      { error: `The AI backend returned an error: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  if (billed === "payg") {
    if (nextDevPaygAccrued) {
      await q("UPDATE users SET payg_accrued = $1 WHERE id = $2", [
        nextDevPaygAccrued,
        user.id,
      ]);
    } else {
      const requestId = `kris-msg-${user.id}-${crypto.randomUUID()}`;
      const usage = await reportUsage(user.wallet_address!, PAYG_PRICE_USDC_MICROS, requestId);
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
      await q("UPDATE users SET payg_accrued = $1 WHERE id = $2", [
        String(usage.body?.accruedUsageUsdc ?? user.payg_accrued),
        user.id,
      ]);
    }
  }

  await q("INSERT INTO messages (user_id, role, content, billed) VALUES ($1, 'user', $2, $3)", [
    user.id,
    message.trim(),
    billed,
  ]);

  await q(
    "INSERT INTO messages (user_id, role, content, billed) VALUES ($1, 'assistant', $2, NULL)",
    [user.id, reply]
  );

  return Response.json({ reply, billed });
}
