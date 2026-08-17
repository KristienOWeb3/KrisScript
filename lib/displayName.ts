/**
 * Display-name rules for the paid name-change flow.
 *
 * Kept server-side so the $1 USDC charge can never be raised for a name that
 * would then be rejected on fulfillment — validate before creating the intent.
 */

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 32;

/** Letters, digits, spaces, and a small set of separators. */
const ALLOWED = /^[\p{L}\p{N} ._-]+$/u;

/**
 * Result of a name check. Kept as one flat shape rather than a discriminated
 * union because this project compiles with `strict: false`, which disables the
 * narrowing that `{ok:true}|{ok:false}` would need at the call site.
 */
export type NameCheck = { ok: boolean; value?: string; error?: string };

/**
 * Trim, collapse internal whitespace, and validate. Returns the canonical
 * value to store, or the reason it was rejected.
 */
export function normalizeDisplayName(raw: unknown): NameCheck {
  if (typeof raw !== "string") {
    return { ok: false, error: "Display name is required." };
  }

  const value = raw.trim().replace(/\s+/g, " ");

  if (value.length < DISPLAY_NAME_MIN) {
    return { ok: false, error: `Display name must be at least ${DISPLAY_NAME_MIN} characters.` };
  }
  if (value.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.` };
  }
  if (!ALLOWED.test(value)) {
    return {
      ok: false,
      error: "Display name may only contain letters, numbers, spaces, dots, hyphens, and underscores.",
    };
  }
  if (!/^[\p{L}\p{N}]/u.test(value) || !/[\p{L}\p{N}]$/u.test(value)) {
    return { ok: false, error: "Display name must start and end with a letter or number." };
  }

  return { ok: true, value };
}

/** The name shown in the UI: explicit display name, else the email local-part. */
export function resolveDisplayName(
  displayName: string | null | undefined,
  email: string | null | undefined
): string {
  if (displayName && displayName.trim()) return displayName;
  if (email && email.includes("@")) return email.split("@")[0];
  return email || "there";
}
