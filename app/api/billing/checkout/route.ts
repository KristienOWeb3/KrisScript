import crypto from "crypto";
import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { createIntent, createSubscription, SubScriptError } from "@/lib/subscript";
import { PRODUCTS, type ProductKey } from "@/lib/plans";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { product, walletAddress } = (await req.json().catch(() => ({}))) as {
    product?: ProductKey;
    walletAddress?: string;
  };
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
  let subscriberAddress: string | null = null;
  if (spec.kind === "subscription") {
    const rawSubscriber = (walletAddress || user.wallet_address || "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(rawSubscriber)) {
      return Response.json(
        { error: "Enter a valid Arc wallet address before creating a subscription checkout." },
        { status: 400 }
      );
    }
    subscriberAddress = rawSubscriber.toLowerCase();
    if (subscriberAddress !== user.wallet_address) {
      await q("UPDATE users SET wallet_address = $1 WHERE id = $2", [
        subscriberAddress,
        user.id,
      ]);
    }
  }

  // One payments row per logical checkout; its id doubles as the SubScript
  // idempotencyKey so a retried request replays the same checkout/subscription.
  const paymentId = crypto.randomUUID();
  await q(
    "INSERT INTO payments (id, user_id, product, amount_micros) VALUES ($1, $2, $3, $4)",
    [paymentId, user.id, product, spec.amountUsdcMicros]
  );
  const externalReference = `${product}:${user.id}:${paymentId}`;

  try {
    if (spec.kind === "subscription") {
      // Pro / Pro Max are real recurring subscriptions on SubScript.
      const result = await createSubscription({
        title: spec.title,
        description: spec.description,
        amountUsdcMicros: spec.amountUsdcMicros,
        interval: (spec as { interval: string }).interval,
        subscriber: subscriberAddress!,
        publishToDm: (spec as { publishToDm?: boolean }).publishToDm ?? false,
        externalReference,
        idempotencyKey: paymentId,
      });
      await q("UPDATE payments SET intent_id = $1 WHERE id = $2", [
        result.subscription.id,
        paymentId,
      ]);
      // Record the subscription id on the user immediately so cancel works
      // even before the first webhook lands.
      await q("UPDATE users SET subscription_id = $1, sub_status = $2 WHERE id = $3", [
        result.subscription.id,
        result.subscription.status,
        user.id,
      ]);
      return Response.json({
        checkoutUrl: result.subscription.checkoutUrl,
        intentId: result.subscription.id,
        subscription: true,
        devMode: result.devMode,
      });
    }

    // One-time checkout (the $1 activation fee).
    const result = await createIntent({
      title: spec.title,
      description: spec.description,
      amountUsdcMicros: spec.amountUsdcMicros,
      externalReference,
      idempotencyKey: paymentId,
    });
    await q("UPDATE payments SET intent_id = $1, receipt_token = $2 WHERE id = $3", [
      result.intent.id,
      result.intent.receiptToken,
      paymentId,
    ]);
    return Response.json({
      checkoutUrl: result.intent.checkoutUrl,
      intentId: result.intent.id,
      subscription: false,
      devMode: result.devMode,
    });
  } catch (err) {
    const e = err as SubScriptError;
    await q("UPDATE payments SET status = 'FAILED' WHERE id = $1", [paymentId]);
    return Response.json(
      { error: e.message, code: e.code, requestId: e.requestId },
      { status: 502 }
    );
  }
}
