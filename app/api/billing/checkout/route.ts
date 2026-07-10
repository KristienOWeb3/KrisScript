import crypto from "crypto";
import db from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { createIntent, SubScriptError } from "@/lib/subscript";
import { PRODUCTS, type ProductKey } from "@/lib/plans";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { product } = (await req.json().catch(() => ({}))) as { product?: ProductKey };
  if (!product || !(product in PRODUCTS)) {
    return Response.json({ error: "Unknown product." }, { status: 400 });
  }
  if (product === "signup" && user.activated) {
    return Response.json({ error: "Account is already activated." }, { status: 400 });
  }
  if (product !== "signup" && !user.activated) {
    return Response.json({ error: "Pay the $1 activation fee first." }, { status: 402 });
  }

  const spec = PRODUCTS[product];
  // One payments row per logical checkout; its id doubles as the SubScript
  // idempotencyKey so a retried request replays the same intent.
  const paymentId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO payments (id, user_id, product, amount_micros) VALUES (?, ?, ?, ?)"
  ).run(paymentId, user.id, product, spec.amountUsdcMicros);

  try {
    const result = await createIntent({
      title: spec.title,
      description: spec.description,
      amountUsdcMicros: spec.amountUsdcMicros,
      externalReference: `${product}:${user.id}:${paymentId}`,
      idempotencyKey: paymentId,
    });
    db.prepare("UPDATE payments SET intent_id = ?, receipt_token = ? WHERE id = ?").run(
      result.intent.id,
      result.intent.receiptToken,
      paymentId
    );
    return Response.json({
      checkoutUrl: result.intent.checkoutUrl,
      intentId: result.intent.id,
      devMode: result.devMode,
    });
  } catch (err) {
    const e = err as SubScriptError;
    db.prepare("UPDATE payments SET status = 'FAILED' WHERE id = ?").run(paymentId);
    return Response.json(
      {
        error: e.message,
        code: e.code,
        requestId: e.requestId,
      },
      { status: 502 }
    );
  }
}
