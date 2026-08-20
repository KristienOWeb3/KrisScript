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
import { planQuota, subAlertMessage, giftNotice } from "@/lib/billing";

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
      subStatus: user.sub_status ?? null,
      /* Whether this period was paid for by somebody else. A gift is a one-time
         payment with no standing authorization behind it, so it will not renew —
         the account looks exactly like a paying subscriber otherwise, right up
         until it lapses, so both the flag and the wording are sent. */
      planGifted: !!user.plan_gifted,
      planGiftedBy: user.plan_gifted_by ?? null,
      giftNotice: giftNotice(user),
      /* A standing advisory from the subscription lifecycle. allowance_low is
         the one that needs to reach the subscriber: the spending authorization
         is running out of cycles and only re-authorizing fixes it. */
      subAlert: user.sub_alert ?? null,
      subAlertMessage: subAlertMessage(user.sub_alert),
      freeUsed: freeRow?.c ?? 0,
      freeCap: FREE_MESSAGE_CAP,
      paygEnabled: !!user.payg_enabled,
      /* Two distinct identifiers, not one field that holds either. The address
         is what a subscription is bound to (and what makes SubScript write a DM
         offer); the commit id is what metered usage is billed against. */
      walletAddress: user.wallet_address,
      commitId: user.commit_id,
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
