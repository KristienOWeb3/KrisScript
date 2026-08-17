import crypto from "crypto";
import { q, one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { createIntent, SubScriptError } from "@/lib/subscript";
import { NAME_CHANGE_PRICE_USDC, NAME_CHANGE_PRICE_USDC_MICROS } from "@/lib/plans";
import { normalizeDisplayName, resolveDisplayName } from "@/lib/displayName";

const PRODUCT = "name_change";

/**
 * Start a paid display-name change: $1 USDC one-time, via SubScript checkout.
 *
 * The requested name is parked in users.pending_display_name and only becomes
 * the live display_name once the payment is fulfilled (webhook or return),
 * so an abandoned checkout never changes the name.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { displayName } = (await req.json().catch(() => ({}))) as { displayName?: string };

  const check = normalizeDisplayName(displayName);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const current = resolveDisplayName(user.display_name, user.email);
  if (check.value === current) {
    return Response.json(
      { error: "That is already your display name — nothing to change." },
      { status: 400 }
    );
  }

  const paymentId = `pay_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  await q(
    "INSERT INTO payments (id, user_id, product, amount_micros, status) VALUES ($1, $2, $3, $4, 'PENDING')",
    [paymentId, user.id, PRODUCT, NAME_CHANGE_PRICE_USDC_MICROS]
  );
  await q("UPDATE users SET pending_display_name = $1 WHERE id = $2", [check.value, user.id]);

  try {
    const { devMode, intent } = await createIntent({
      title: "Display name change",
      description: `Change the Kris's Script display name to "${check.value}"`,
      amountUsdcMicros: NAME_CHANGE_PRICE_USDC_MICROS,
      // fulfillPayment() parses the payment id out of the third segment.
      externalReference: `${PRODUCT}:${user.id}:${paymentId}`,
      idempotencyKey: paymentId,
    });

    await q("UPDATE payments SET intent_id = $1, receipt_token = $2 WHERE id = $3", [
      intent.id,
      intent.receiptToken,
      paymentId,
    ]);

    return Response.json({
      paymentId,
      devMode,
      checkoutUrl: intent.checkoutUrl,
      requestedName: check.value,
      priceUsdc: NAME_CHANGE_PRICE_USDC,
    });
  } catch (err) {
    // Roll back so an unreachable SubScript doesn't leave a phantom pending name.
    await q("DELETE FROM payments WHERE id = $1", [paymentId]);
    await q("UPDATE users SET pending_display_name = NULL WHERE id = $1", [user.id]);

    const message =
      err instanceof SubScriptError
        ? err.message
        : "Could not reach SubScript to start the payment.";
    return Response.json({ error: message }, { status: 502 });
  }
}

/** Abandon a pending name change and drop its unpaid intent. */
export async function DELETE() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  await q(
    "DELETE FROM payments WHERE user_id = $1 AND product = $2 AND status = 'PENDING'",
    [user.id, PRODUCT]
  );
  await q("UPDATE users SET pending_display_name = NULL WHERE id = $1", [user.id]);

  const fresh = await one<{ display_name: string | null }>(
    "SELECT display_name FROM users WHERE id = $1",
    [user.id]
  );
  return Response.json({
    ok: true,
    displayName: resolveDisplayName(fresh?.display_name, user.email),
  });
}
