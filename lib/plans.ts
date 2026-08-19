export const FREE_MESSAGE_CAP = 3;
export const PAYG_PRICE_USDC = "0.10";
export const PAYG_PRICE_USDC_MICROS = "100000";
export const DEV_VAULT_COMMIT_USDC = 5.0;

/** One-time charge to change the account display name. */
export const NAME_CHANGE_PRICE_USDC = "1.00";
export const NAME_CHANGE_PRICE_USDC_MICROS = "1000000";

/* ── Subscription plans ───────────────────────────────────────────────
 * Monthly recurring via SubScript. Each tier grants a message allowance
 * that resets when the subscription renews.
 *
 * Note the deliberate pricing: every tier works out to $0.20 per message,
 * twice the $0.10 metered rate. That is intentional per product decision —
 * plans are a commitment product, not a volume discount — so do not
 * "helpfully" rebalance the numbers without asking.
 * ─────────────────────────────────────────────────────────────────── */

export type PlanId = "pro" | "promax" | "ultra";

export type Plan = {
  id: PlanId;
  name: string;
  priceUsdc: string;
  priceUsdcMicros: string;
  /** Messages granted per billing month. */
  messages: number;
};

export const PLANS: Record<PlanId, Plan> = {
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdc: "2.00",
    priceUsdcMicros: "2000000",
    messages: 10,
  },
  promax: {
    id: "promax",
    name: "Pro Max",
    priceUsdc: "5.00",
    priceUsdcMicros: "5000000",
    messages: 25,
  },
  ultra: {
    id: "ultra",
    name: "Ultra",
    priceUsdc: "10.00",
    priceUsdcMicros: "10000000",
    messages: 50,
  },
};

/** Cheapest first, for rendering. */
export const PLAN_ORDER: PlanId[] = ["pro", "promax", "ultra"];

/** SubScript billing interval for every tier. */
export const PLAN_INTERVAL = "monthly";

/**
 * Length of a billing period. handleSubscriptionEvent grants
 * plan_expires_at = now + this on created/renewed, so the current period
 * runs from (plan_expires_at - this) to plan_expires_at.
 */
export const PLAN_DURATION_SECONDS = 30 * 86400;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLANS, value);
}

/** The plan record, or undefined for "free" / "payg" / anything unknown. */
export function getPlan(value: unknown): Plan | undefined {
  return isPlanId(value) ? PLANS[value] : undefined;
}

/**
 * Start of the current billing period, for counting this month's usage.
 * Returns 0 when there is no active period, which makes any count fall back
 * to "everything", so callers must check the plan is active first.
 */
export function planPeriodStart(planExpiresAt: number | null | undefined): number {
  if (!planExpiresAt) return 0;
  return planExpiresAt - PLAN_DURATION_SECONDS;
}

/** A plan only counts while it has not expired, cancelled or not. */
export function planIsActive(
  plan: unknown,
  planExpiresAt: number | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!isPlanId(plan)) return false;
  return !!planExpiresAt && planExpiresAt > nowSeconds;
}

/* ── USDC money helpers ───────────────────────────────────────────────
 * Balances are held as TEXT in the database and arrive from SubScript as
 * arbitrary numeric strings ("0.1", "0.100000", "1e-1"). Arithmetic runs
 * through integer micros so totals are exact, and every value shown to a
 * user goes through formatUsdc so the same balance never renders as "$0"
 * in one place and "$0.10" in another.
 * ─────────────────────────────────────────────────────────────────── */

/** USDC has 6 decimals. Accepts any numeric form; non-numeric becomes 0. */
export function usdcToMicros(usdc: string | number | null | undefined): bigint {
  const n = Number(usdc);
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.round(n * 1_000_000));
}

/** Render integer micros as a fixed 2-decimal string, e.g. "0.10". */
export function microsToUsdc(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const cents = (abs + 5000n) / 10_000n; // round half-up to the cent
  return `${neg ? "-" : ""}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

/** Normalise any stored or reported balance to "0.00" form for display. */
export function formatUsdc(value: string | number | null | undefined): string {
  return microsToUsdc(usdcToMicros(value));
}
