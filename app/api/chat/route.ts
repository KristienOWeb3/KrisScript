import crypto from "crypto";
import { q, one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { chatCompletion } from "@/lib/deepseek";
import { hasRealKey, reportUsage } from "@/lib/subscript";
import {
  FREE_MESSAGE_CAP,
  PAYG_PRICE_USDC,
  PAYG_PRICE_USDC_MICROS,
  DEV_VAULT_COMMIT_USDC,
  usdcToMicros,
  microsToUsdc,
} from "@/lib/plans";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const threadId = url.searchParams.get("thread_id");

  // Retrieve distinct recent threads for sidebar
  const { rows: threadRows } = await q(
    `SELECT DISTINCT ON (COALESCE(thread_id, 'main')) 
       COALESCE(thread_id, 'main') AS thread_id,
       content AS title,
       created_at
     FROM messages 
     WHERE user_id = $1 AND role = 'user'
     ORDER BY COALESCE(thread_id, 'main'), id ASC`,
    [user.id]
  );

  const recents = threadRows
    .map((r) => ({
      threadId: r.thread_id,
      title: r.title ? (r.title.length > 38 ? r.title.slice(0, 38) + "..." : r.title) : "New Chat",
      createdAt: r.created_at,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);

  const activeThread = threadId || (recents[0]?.threadId ?? null);

  let messages: any[] = [];
  if (activeThread) {
    const { rows } = await q(
      activeThread === "main"
        ? "SELECT role, content, billed, created_at FROM messages WHERE user_id = $1 AND (thread_id IS NULL OR thread_id = 'main') ORDER BY id ASC LIMIT 200"
        : "SELECT role, content, billed, created_at FROM messages WHERE user_id = $1 AND thread_id = $2 ORDER BY id ASC LIMIT 200",
      activeThread === "main" ? [user.id] : [user.id, activeThread]
    );
    messages = rows;
  }

  return Response.json({ messages, recents, activeThreadId: activeThread });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { message, threadId } = (await req.json().catch(() => ({}))) as {
    message?: string;
    threadId?: string;
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  const activeThread = threadId || "main";
  let billed: "payg" | "free";
  let nextDevPaygAccrued: string | null = null;

  const freeUsed = await one<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM messages WHERE user_id = $1 AND role = 'user' AND billed = 'free'",
    [user.id]
  );

  if ((freeUsed?.c ?? 0) < FREE_MESSAGE_CAP) {
    billed = "free";
  } else if (user.payg_enabled && user.wallet_address) {
    if (!hasRealKey()) {
      const priceMicros = BigInt(PAYG_PRICE_USDC_MICROS);
      const alreadyMicros = usdcToMicros(user.payg_accrued);
      const accruedMicros = alreadyMicros + priceMicros;
      if (accruedMicros > usdcToMicros(DEV_VAULT_COMMIT_USDC)) {
        return Response.json(
          {
            // Report what is actually on the clock, not the rejected total.
            error: `Simulated vault exhausted (accrued $${microsToUsdc(alreadyMicros)} of $${microsToUsdc(usdcToMicros(DEV_VAULT_COMMIT_USDC))} commit). Re-fund your vault to continue.`,
            reason: "vault",
          },
          { status: 402 }
        );
      }
      nextDevPaygAccrued = microsToUsdc(accruedMicros);
    }
    billed = "payg";
  } else {
    return Response.json(
      {
        error: `You have used your ${FREE_MESSAGE_CAP} free trial messages. Enable SubScript Pay-As-You-Go ($${PAYG_PRICE_USDC}/msg) to continue.`,
        reason: "payg_required",
      },
      { status: 402 }
    );
  }

  const { rows: recent } = await q(
    activeThread === "main"
      ? "SELECT role, content FROM messages WHERE user_id = $1 AND (thread_id IS NULL OR thread_id = 'main') ORDER BY id DESC LIMIT 20"
      : "SELECT role, content FROM messages WHERE user_id = $1 AND thread_id = $2 ORDER BY id DESC LIMIT 20",
    activeThread === "main" ? [user.id] : [user.id, activeThread]
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
      /* SubScript's running total is authoritative when it sends one. When it
         doesn't, the charge still succeeded (status 200), so add the price
         locally — the previous code fell back to the OLD balance, which left
         the user billed while the figure on screen never moved. */
      const reported = usage.body?.accruedUsageUsdc;
      const nextAccrued =
        reported != null && Number.isFinite(Number(reported))
          ? microsToUsdc(usdcToMicros(reported))
          : microsToUsdc(usdcToMicros(user.payg_accrued) + BigInt(PAYG_PRICE_USDC_MICROS));
      await q("UPDATE users SET payg_accrued = $1 WHERE id = $2", [nextAccrued, user.id]);
    }
  }

  await q(
    "INSERT INTO messages (user_id, thread_id, role, content, billed) VALUES ($1, $2, 'user', $3, $4)",
    [user.id, activeThread, message.trim(), billed]
  );

  await q(
    "INSERT INTO messages (user_id, thread_id, role, content, billed) VALUES ($1, $2, 'assistant', $3, NULL)",
    [user.id, activeThread, reply]
  );

  return Response.json({ reply, billed, threadId: activeThread });
}
