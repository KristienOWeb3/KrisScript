import { one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { hasRealKey } from "@/lib/subscript";
import {
  FREE_MESSAGE_CAP,
  NAME_CHANGE_PRICE_USDC,
  PAYG_PRICE_USDC_MICROS,
  microsToUsdc,
} from "@/lib/plans";
import { resolveDisplayName } from "@/lib/displayName";
import { planQuota } from "@/lib/billing";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ user: null });

  const freeRow = await one<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM messages WHERE user_id = $1 AND role = 'user' AND billed = 'free'",
    [user.id]
  );

  /* The accrued balance is computed from our own billing ledger rather than
     mirrored out of users.payg_accrued. SubScript's report-usage returns
     integer MICROS in a field named accruedUsageUsdc, so the stored value was
     a micro count while the UI printed it as dollars — a real $2.20 balance
     rendered as $2,200,000.00. Counting the messages we actually billed is
     exact and does not depend on that field's units. */
  const paygRow = await one<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM messages WHERE user_id = $1 AND role = 'user' AND billed = 'payg'",
    [user.id]
  );
  const paygAccrued = microsToUsdc(
    BigInt(paygRow?.c ?? 0) * BigInt(PAYG_PRICE_USDC_MICROS)
  );

  // Same helper the chat gate uses, so the number shown always matches the
  // number enforced.
  const quota = await planQuota(user);

  return Response.json({
    user: {
      email: user.email,
      activated: true,
      plan: quota.active ? quota.planId : user.payg_enabled ? "payg" : "free",
      planName: quota.planName,
      planActive: quota.active,
      planCap: quota.cap,
      planUsed: quota.used,
      planRemaining: quota.remaining,
      planExpiresAt: quota.expiresAt,
      subCancelAtPeriodEnd: !!user.sub_cancel_at_period_end,
      freeUsed: freeRow?.c ?? 0,
      freeCap: FREE_MESSAGE_CAP,
      paygEnabled: !!user.payg_enabled,
      walletAddress: user.wallet_address,
      paygAccrued,
      paygMessages: paygRow?.c ?? 0,
      displayName: resolveDisplayName(user.display_name, user.email),
      hasCustomName: !!user.display_name,
      pendingDisplayName: user.pending_display_name,
    },
    nameChangePriceUsdc: NAME_CHANGE_PRICE_USDC,
    devMode: !hasRealKey(),
  });
}
