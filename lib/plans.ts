export const FREE_MESSAGE_CAP = 3;
export const PAYG_PRICE_USDC = "0.10";
export const PAYG_PRICE_USDC_MICROS = "100000";
export const DEV_VAULT_COMMIT_USDC = 5.0;

/** One-time charge to change the account display name. */
export const NAME_CHANGE_PRICE_USDC = "1.00";
export const NAME_CHANGE_PRICE_USDC_MICROS = "1000000";

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
