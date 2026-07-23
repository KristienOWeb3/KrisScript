import { q, one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { hasRealKey, cancelSubscription, getSubscription } from "@/lib/subscript";
import { FREE_MESSAGE_CAP, PRO_DAILY_CAP } from "@/lib/plans";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ user: null });

  // Background status check: if active plan is not marked as canceled yet, check SubScript
  if (user.plan !== "free" && !user.sub_cancel_at_period_end) {
    const targetId = user.subscription_id || user.wallet_address || "";
    if (targetId) {
      try {
        const { status: httpStatus, subscription } = await getSubscription(targetId);
        const subStatus = subscription?.status || "";
        const cancelAt = subscription?.cancel_at_period_end ?? subscription?.cancelAtPeriodEnd;
        let isCanceled =
          subStatus === "canceled" ||
          subStatus === "cancelled" ||
          subStatus === "deleted" ||
          cancelAt === true;

        if (!isCanceled && user.subscription_id) {
          const cancelCheck = await cancelSubscription(user.subscription_id);
          if (cancelCheck.status === 409 || cancelCheck.status === 200 || cancelCheck.status === 404) {
            isCanceled = true;
          }
        }

        if (isCanceled) {
          await q(
            "UPDATE users SET sub_cancel_at_period_end = 1, sub_status = 'canceled' WHERE id = $1",
            [user.id]
          );
          user.sub_cancel_at_period_end = 1;
          user.sub_status = "canceled";
        }
      } catch (e) {
        console.warn("[/api/me] Background sync notice:", e);
      }
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const planActive =
    (user.plan === "pro" || user.plan === "promax") && (user.plan_expires_at ?? 0) > now;

  const freeRow = await one<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM messages WHERE user_id = $1 AND role = 'user' AND billed = 'free'",
    [user.id]
  );
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const todayRow = await one<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM messages WHERE user_id = $1 AND role = 'user' AND created_at >= $2",
    [user.id, startOfDay]
  );
  const pendingPayment = await one<{
    id: string;
    product: string;
    intent_id: string | null;
    created_at: number;
  }>(
    "SELECT id, product, intent_id, created_at FROM payments WHERE user_id = $1 AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1",
    [user.id]
  );

  return Response.json({
    user: {
      email: user.email,
      activated: !!user.activated,
      plan: planActive ? user.plan : "free",
      planExpiresAt: planActive ? user.plan_expires_at : null,
      freeUsed: freeRow?.c ?? 0,
      freeCap: FREE_MESSAGE_CAP,
      proDailyCap: PRO_DAILY_CAP,
      todayCount: todayRow?.c ?? 0,
      paygEnabled: !!user.payg_enabled,
      walletAddress: user.wallet_address,
      paygAccrued: user.payg_accrued,
      subscriptionId: user.subscription_id,
      subStatus: user.sub_status,
      subCancelAtPeriodEnd: !!user.sub_cancel_at_period_end,
      pendingPayment: pendingPayment
        ? {
            product: pendingPayment.product,
            intentId: pendingPayment.intent_id,
            createdAt: pendingPayment.created_at,
          }
        : null,
    },
    devMode: !hasRealKey(),
  });
}
