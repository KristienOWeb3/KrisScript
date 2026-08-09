import { one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { hasRealKey } from "@/lib/subscript";
import { FREE_MESSAGE_CAP } from "@/lib/plans";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ user: null });

  const freeRow = await one<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM messages WHERE user_id = $1 AND role = 'user' AND billed = 'free'",
    [user.id]
  );

  return Response.json({
    user: {
      email: user.email,
      activated: true,
      plan: user.payg_enabled ? "payg" : "free",
      freeUsed: freeRow?.c ?? 0,
      freeCap: FREE_MESSAGE_CAP,
      paygEnabled: !!user.payg_enabled,
      walletAddress: user.wallet_address,
      paygAccrued: user.payg_accrued,
    },
    devMode: !hasRealKey(),
  });
}
