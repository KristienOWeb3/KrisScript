import { one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { hasRealKey } from "@/lib/subscript";
import { FREE_MESSAGE_CAP, PRO_DAILY_CAP } from "@/lib/plans";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ user: null });

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
    },
    devMode: !hasRealKey(),
  });
}
