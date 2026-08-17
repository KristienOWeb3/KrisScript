import { one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { hasRealKey } from "@/lib/subscript";
import { FREE_MESSAGE_CAP, NAME_CHANGE_PRICE_USDC, formatUsdc } from "@/lib/plans";
import { resolveDisplayName } from "@/lib/displayName";

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
      // Normalised here so every screen renders the same balance identically.
      paygAccrued: formatUsdc(user.payg_accrued),
      displayName: resolveDisplayName(user.display_name, user.email),
      hasCustomName: !!user.display_name,
      pendingDisplayName: user.pending_display_name,
    },
    nameChangePriceUsdc: NAME_CHANGE_PRICE_USDC,
    devMode: !hasRealKey(),
  });
}
