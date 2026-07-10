import db from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { hasRealKey } from "@/lib/subscript";
import { FREE_MESSAGE_CAP, PRO_DAILY_CAP } from "@/lib/plans";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ user: null });

  const now = Math.floor(Date.now() / 1000);
  const planActive =
    (user.plan === "pro" || user.plan === "promax") && (user.plan_expires_at ?? 0) > now;

  const freeUsed = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND role = 'user' AND billed = 'free'"
      )
      .get(user.id) as { c: number }
  ).c;

  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const todayCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND role = 'user' AND created_at >= ?"
      )
      .get(user.id, startOfDay) as { c: number }
  ).c;

  return Response.json({
    user: {
      email: user.email,
      activated: !!user.activated,
      plan: planActive ? user.plan : "free",
      planExpiresAt: planActive ? user.plan_expires_at : null,
      freeUsed,
      freeCap: FREE_MESSAGE_CAP,
      proDailyCap: PRO_DAILY_CAP,
      todayCount,
      paygEnabled: !!user.payg_enabled,
      walletAddress: user.wallet_address,
      paygAccrued: user.payg_accrued,
    },
    devMode: !hasRealKey(),
  });
}
