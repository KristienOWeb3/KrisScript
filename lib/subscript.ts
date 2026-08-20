import crypto from "crypto";

const BASE = "https://www.subscriptonarc.com";
const DEV_WEBHOOK_SECRET = "dev-webhook-secret";

export function hasRealKey(): boolean {
  return !!process.env.SUBSCRIPT_SECRET_KEY;
}

export function webhookSecret(): string {
  return process.env.SUBSCRIPT_WEBHOOK_SECRET || DEV_WEBHOOK_SECRET;
}

/**
 * Whether a real webhook secret is configured. DEV_WEBHOOK_SECRET is a literal
 * in a public repo, so falling back to it in production turns a missing env var
 * into an endless stream of "invalid signature" 401s that look like an attack
 * rather than the misconfiguration they are. Callers use this to say so.
 */
export function hasWebhookSecret(): boolean {
  return !!process.env.SUBSCRIPT_WEBHOOK_SECRET;
}

/**
 * How far a signature timestamp may be from now.
 *
 * Deliberately generous. Providers retry failed deliveries by re-POSTing the
 * payload they already signed, so a tight window makes every retry after that
 * cutoff permanently unverifiable — a queue that has been stuck for an hour can
 * never drain, no matter how often it is reclaimed. Replay damage is already
 * prevented by the UNIQUE event id and atomic claim in the webhook route, which
 * turn a repeat into a no-op, so this bound is defence in depth rather than the
 * primary control.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 24 * 60 * 60;

export function appUrl(): string {
  const url =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return url.replace(/\/$/, "");
}

/* ── Webhook event envelope ───────────────────────────────────────────
 * Two shapes have to be read interchangeably.
 *
 * Real deliveries nest the payload under `data.object` and emit every field
 * twice, once snake_case and once camelCase, with identical values
 * (`merchant_customer_id` / `merchantCustomerId`). Our own dev simulation and
 * the events already stored in webhook_events are flat snake_case. Reading
 * through eventObject() + field() means one handler serves all of them, and a
 * stored event can still be replayed after this change.
 * ─────────────────────────────────────────────────────────────────── */

/** Unwrap `data.object` when present; otherwise treat `data` as the payload. */
export function eventObject(data: any): any {
  if (data && typeof data === "object" && data.object && typeof data.object === "object") {
    return data.object;
  }
  return data ?? {};
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Read a field by its snake_case name, accepting the camelCase spelling too,
 * and try each name in order. Absent means undefined/null/"" — `false` and `0`
 * are real values and come back as themselves.
 */
export function field(obj: any, ...names: string[]): any {
  if (!obj || typeof obj !== "object") return undefined;
  for (const name of names) {
    for (const key of name === toCamel(name) ? [name] : [name, toCamel(name)]) {
      const value = obj[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

/**
 * Normalise a timestamp to epoch seconds. Accepts seconds, milliseconds and
 * ISO strings, since the same logical field arrives in all three forms
 * (`currentPeriodEnd` as ISO, `currentPeriodEndTimestamp` as a number).
 */
export function toEpochSeconds(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim();
  if (typeof value === "number" || /^\d+$/.test(raw)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Anything past year 5138 in seconds is really milliseconds.
    return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
  }
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null;
}

/** Which environment this deployment's key belongs to, or null in dev mode. */
export function expectedEnvironment(): "LIVE" | "TEST" | null {
  const key = process.env.SUBSCRIPT_SECRET_KEY;
  if (!key) return null;
  return key.startsWith("sk_live_") ? "LIVE" : "TEST";
}

/**
 * Describe an environment mismatch, or null when the event is acceptable.
 *
 * Events carry `environment` (TEST/LIVE) and `livemode`, and a delivery whose
 * environment disagrees with our key must not be fulfilled: a TEST event
 * reaching a live deployment would grant a real plan for a sandbox charge.
 *
 * Silence when either side is unstamped rather than guessing. Dev mode has no
 * key to compare against, and our own simulated events carry no environment.
 */
export function environmentMismatch(obj: any): string | null {
  const expected = expectedEnvironment();
  if (!expected) return null;

  const stamped = field(obj, "environment");
  const livemode = field(obj, "livemode");
  const actual =
    typeof stamped === "string" && stamped.trim()
      ? stamped.trim().toUpperCase()
      : typeof livemode === "boolean"
        ? livemode
          ? "LIVE"
          : "TEST"
        : null;

  if (!actual || (actual !== "LIVE" && actual !== "TEST")) return null;
  if (actual === expected) return null;
  return `event is ${actual}, this deployment's key is ${expected}`;
}

/**
 * Whether to publish plan checkouts into SubScript's plan catalogue and DM flow.
 *
 * Off unless SUBSCRIPT_PUBLISH_TO_DM says otherwise. Publishing is not a local
 * concern: MerchantPlan carries no environment of its own and no plan query
 * filters on one, so a plan created with a test key sits in the same public
 * catalogue as live plans and is subscribable with real money. Fine on testnet,
 * not something a mainnet deploy should opt into by accident.
 */
export function publishToDmEnabled(): boolean {
  const raw = (process.env.SUBSCRIPT_PUBLISH_TO_DM || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export class SubScriptError extends Error {
  code?: string;
  requestId?: string;
  status?: number;
  constructor(message: string, opts: { code?: string; requestId?: string; status?: number } = {}) {
    super(message);
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.status = opts.status;
  }
}

export type IntentResult = {
  devMode: boolean;
  intent: {
    id: string;
    checkoutUrl: string;
    receiptToken: string;
    status: string;
  };
};

/**
 * Create a SubScript Checkout Intent (POST /api/intent).
 * When no SUBSCRIPT_SECRET_KEY is configured, returns a simulated intent that
 * routes to the local /dev/checkout page so the full flow can be tested offline.
 */
export async function createIntent(opts: {
  title: string;
  description?: string;
  amountUsdcMicros: string;
  externalReference: string;
  idempotencyKey: string;
}): Promise<IntentResult> {
  if (!hasRealKey()) {
    const id = `dev_intent_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    return {
      devMode: true,
      intent: {
        id,
        checkoutUrl: `${appUrl()}/dev/checkout?intent=${id}`,
        receiptToken: `rcpt-dev-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        status: "PENDING",
      },
    };
  }

  const key = process.env.SUBSCRIPT_SECRET_KEY!;
  const body: Record<string, unknown> = {
    title: opts.title,
    description: opts.description,
    amountUsdcMicros: opts.amountUsdcMicros,
    externalReference: opts.externalReference,
    idempotencyKey: opts.idempotencyKey,
    sandbox: !key.startsWith("sk_live_"),
  };
  // SubScript requires HTTPS redirect URLs; skip them for plain-http local dev.
  if (appUrl().startsWith("https://")) {
    body.successUrl = `${appUrl()}/billing/success`;
    body.cancelUrl = `${appUrl()}/billing/cancel`;
  }

  const res = await fetch(`${BASE}/api/intent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json.intent) {
    const errMsg = json.message || json.error || "";
    if (errMsg.includes("Premium subscription")) {
      console.warn("SubScript API key returned Premium subscription 403; falling back to dev mode checkout.");
      return {
        devMode: true,
        intent: {
          id: opts.idempotencyKey || `intent_dev_${Date.now()}`,
          checkoutUrl: `${appUrl()}/dev/checkout?intent=${encodeURIComponent(opts.idempotencyKey || "")}`,
          receiptToken: `rec_dev_${Date.now()}`,
          status: "pending",
        },
      };
    }
    throw new SubScriptError(
      errMsg || `SubScript /api/intent failed (HTTP ${res.status})`,
      { code: json.code, requestId: json.request_id, status: res.status }
    );
  }
  return {
    devMode: false,
    intent: {
      id: json.intent.id,
      checkoutUrl: json.intent.checkoutUrl,
      receiptToken: json.intent.receiptToken,
      status: json.intent.status,
    },
  };
}

export type SubscriptionResult = {
  devMode: boolean;
  subscription: {
    /** The checkout session id. The on-chain subscription id — the one DELETE
     *  requires — arrives later, on the first subscription event. */
    id: string;
    checkoutUrl: string;
    status: string;
  };
};

/**
 * Create a real recurring subscription (POST /api/v1/subscriptions).
 * SubScript charges `amountUsdcMicros` every `interval` automatically and
 * emits subscription.created / subscription.renewed webhooks. The returned
 * subscription is a first-class object on the merchant's dashboard.
 * In dev mode (no key) it routes to the local simulated checkout.
 */
export async function createSubscription(opts: {
  title: string;
  description?: string;
  amountUsdcMicros: string;
  interval: string;
  subscriber?: string;
  publishToDm?: boolean;
  externalReference: string;
  idempotencyKey: string;
}): Promise<SubscriptionResult> {
  if (!hasRealKey()) {
    const id = `dev_sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    return {
      devMode: true,
      subscription: {
        id,
        checkoutUrl: `${appUrl()}/dev/checkout?intent=${id}`,
        status: "incomplete",
      },
    };
  }

  const key = process.env.SUBSCRIPT_SECRET_KEY!;
  const isLiveKey = key.startsWith("sk_live_");
  const body: Record<string, unknown> = {
    title: opts.title,
    description: opts.description,
    amountUsdcMicros: opts.amountUsdcMicros,
    interval: opts.interval,
    /* Sent explicitly in both directions, deliberately. Omitting this field
       does NOT mean "off": SubScript publishes unless it receives a literal
       false (`publishToDm !== false`), so silence would opt every deployment
       into the public plan catalogue.

       The previous gate — publish only with a live key — rested on sandbox and
       test keys being unable to publish. They can: the premium-tier check is
       explicitly waived for test mode. Worse, the only caller never passed
       publishToDm, so `opts.publishToDm ?? false` made the ternary false on
       both branches. No code path could ever send true, which is why plans
       never reached the DM flow.

       Note the asymmetry when this is on: publishing creates the catalogue
       plan, but the DM offer is only written when `subscriber` is also sent.
       Without an address you get a plan in the picker and an empty thread. */
    publishToDm: opts.publishToDm ?? publishToDmEnabled(),
    /* Always send our own reference, whether or not we have a subscriber
       address. It is the stable key every subscription event carries back as
       merchant_customer_id / external_reference, and the only field that
       survives a resume — resuming mints a new subscription id, so anything
       keyed on the id alone loses the customer. It is also now returned by
       GET /api/v1/subscriptions, which makes the mapping recoverable after a
       missed delivery. Previously this was sent only alongside `subscriber`,
       so a user without a wallet address produced events with no reference at
       all and fulfillment leaned entirely on the id recorded at creation. */
    externalReference: opts.externalReference,
    /* Omitted rather than sent empty when the account has no address on file:
       the API rejects anything that is not a 0x address here with "invalid
       subscriber address". Sending it is also what makes SubScript write the DM
       subscription offer, so its absence is the difference between a catalogue
       plan with a DM and one with an empty thread. */
    ...(opts.subscriber ? { subscriber: opts.subscriber } : {}),
    idempotencyKey: opts.idempotencyKey,
    sandbox: !isLiveKey,
  };
  if (appUrl().startsWith("https://")) {
    body.successUrl = `${appUrl()}/billing/success`;
    body.cancelUrl = `${appUrl()}/billing/cancel`;
  }

  const res = await fetch(`${BASE}/api/v1/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json.subscription) {
    const errMsg = json.message || json.error || "";
    if (errMsg.includes("Premium subscription")) {
      console.warn("SubScript API key returned Premium subscription 403; falling back to dev mode checkout.");
      return {
        devMode: true,
        subscription: {
          id: opts.idempotencyKey || `sub_dev_${Date.now()}`,
          checkoutUrl: `${appUrl()}/dev/checkout?intent=${encodeURIComponent(opts.idempotencyKey || "")}`,
          status: "incomplete",
        },
      };
    }
    throw new SubScriptError(
      errMsg || `SubScript /api/v1/subscriptions failed (HTTP ${res.status})`,
      { code: json.code, requestId: json.request_id, status: res.status }
    );
  }
  return {
    devMode: false,
    subscription: {
      id: json.subscription.id,
      checkoutUrl: json.subscription.checkoutUrl,
      status: json.subscription.status,
    },
  };
}

/**
 * Cancel a subscription (DELETE /api/v1/subscriptions?id=).
 *
 * Pass the on-chain subscription id — the checkout id the create call returns
 * is not accepted here. users.subscription_id holds the on-chain id once any
 * subscription event has been processed; users.sub_checkout_id holds the
 * checkout session, and is only a last resort.
 */
export async function cancelSubscription(
  id: string,
  userAddress?: string
): Promise<{ status: number; body: any }> {
  if (!hasRealKey()) return { status: 200, body: { id, status: "canceled", devMode: true } };
  
  let res = await fetch(`${BASE}/api/v1/subscriptions?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, subscriptionId: id, userAddress }),
  });
  let body = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Fallback attempt to /api/v1/subscriptions/cancel
    const res2 = await fetch(`${BASE}/api/v1/subscriptions/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, subscriptionId: id, userAddress }),
    });
    const body2 = await res2.json().catch(() => ({}));
    if (res2.ok) return { status: res2.status, body: body2 };
  }

  return { status: res.status, body };
}

/**
 * Fetch a one-time checkout intent by id (GET /api/intent/<id>).
 *
 * This is what makes fulfillment independent of webhook delivery: SubScript
 * remains the authority on whether money moved, but we can ask instead of
 * waiting to be told. Returns `intent: undefined` when the answer is unknown
 * (dev mode, 404, transport error) so callers fail closed.
 */
export async function getIntent(
  id: string
): Promise<{ status: number; intent?: any }> {
  // No real key means no real intents exist; never claim one is paid.
  if (!hasRealKey()) return { status: 200, intent: undefined };
  try {
    const res = await fetch(`${BASE}/api/intent/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}` },
    });
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) return { status: res.status, intent: undefined };
    return { status: res.status, intent: body.intent ?? body.data ?? body };
  } catch {
    return { status: 0, intent: undefined };
  }
}

/**
 * Statuses that mean the money actually arrived. An allow-list rather than a
 * deny-list: an unrecognised status must never read as paid.
 */
const PAID_INTENT_STATUSES = new Set(["PAID", "SUCCEEDED", "COMPLETED"]);

export function intentIsPaid(intent: any): boolean {
  const raw = intent?.status;
  return typeof raw === "string" && PAID_INTENT_STATUSES.has(raw.trim().toUpperCase());
}

/**
 * Every id a subscription record answers to: the on-chain subscription id, the
 * checkout session it came from, and our own reference.
 *
 * `subscriber` is included because /api/billing/sync falls back to looking a
 * subscription up by the user's wallet address when it has no id to work with.
 */
function subscriptionIdentifiers(sub: any): string[] {
  return [
    sub?.id,
    field(sub, "subscription_id"),
    field(sub, "checkout_id"),
    field(sub, "source_checkout_id"),
    field(sub, "external_reference"),
    field(sub, "merchant_customer_id"),
    field(sub, "subscriber"),
  ]
    .filter((v) => typeof v === "string" && v.trim())
    .map((v: string) => v.trim().toLowerCase());
}

/**
 * List subscriptions, optionally filtered server-side.
 *
 * `?externalReference=` is the useful one here: our reference is stable across
 * a resume, so it finds the customer's current subscription even after the id
 * has changed underneath us.
 */
export async function listSubscriptions(
  filter: { externalReference?: string; status?: string } = {}
): Promise<{ status: number; subscriptions: any[] }> {
  if (!hasRealKey()) return { status: 200, subscriptions: [] };
  const params = new URLSearchParams();
  if (filter.externalReference) params.set("externalReference", filter.externalReference);
  if (filter.status) params.set("status", filter.status);
  const suffix = params.toString() ? `?${params}` : "";
  try {
    const res = await fetch(`${BASE}/api/v1/subscriptions${suffix}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}` },
    });
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) return { status: res.status, subscriptions: [] };
    const list: any[] =
      body.data || body.subscriptions || (Array.isArray(body) ? body : []);
    return { status: res.status, subscriptions: Array.isArray(list) ? list : [] };
  } catch {
    return { status: 0, subscriptions: [] };
  }
}

/**
 * Fetch one subscription, by on-chain id or by checkout id.
 *
 * Prefers GET /api/v1/subscriptions/{id}, which accepts either id form. Falls
 * back to listing and matching exactly. The previous implementation only had
 * the list, and matched with `cleanId.includes(sId)` — a substring test that
 * could return a different customer's subscription, and did nothing to
 * distinguish the checkout id (which is what we record at creation) from the
 * on-chain id (which is what DELETE needs).
 */
export async function getSubscription(
  id: string
): Promise<{ status: number; subscription?: any }> {
  if (!hasRealKey()) return { status: 200, subscription: { id, status: "active", devMode: true } };
  const wanted = id.trim().toLowerCase();

  try {
    const res = await fetch(`${BASE}/api/v1/subscriptions/${encodeURIComponent(id.trim())}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}` },
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({} as any));
      const sub = body.subscription ?? body.data ?? body;
      if (sub && typeof sub === "object" && subscriptionIdentifiers(sub).length) {
        return { status: res.status, subscription: sub };
      }
    }
  } catch {
    /* Fall through to the list. */
  }

  const { status, subscriptions } = await listSubscriptions();
  const sub = subscriptions.find((s) => subscriptionIdentifiers(s).includes(wanted));
  return { status, subscription: sub || null };
}

/**
 * Report metered usage against a customer's vault or Commit ID
 * (POST /api/user/vault/report-usage). Returns HTTP status + parsed body;
 * 402 means the vault is inactive / balance exhausted.
 */
/**
 * True only for a real on-chain address.
 *
 * The subscriptions API rejects anything else in `subscriber` with "invalid
 * subscriber address", so a value that might be a vault commit id has to be
 * checked rather than passed through.
 */
export function isWalletAddress(value: string | null | undefined): boolean {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

/**
 * The identifier metered vault usage is reported against.
 *
 * A commit id when the account has one, otherwise the wallet address —
 * report-usage accepts either, under different field names. Returns null when
 * there is nothing usable, so callers gate on it rather than sending "".
 *
 * These used to share one column, which is what kept plans out of the DM flow:
 * the pay-as-you-chat setup asks for a Commit ID, so `wallet_address` usually
 * held `cmt_…`, and the subscribe path could not find an address to send as
 * `subscriber`.
 */
export function usageTarget(user: {
  commit_id?: string | null;
  wallet_address?: string | null;
}): string | null {
  const commit = (user.commit_id || "").trim();
  if (commit) return commit;
  const address = (user.wallet_address || "").trim();
  return isWalletAddress(address) ? address : null;
}

export async function reportUsage(
  userAddressOrCommitId: string,
  amountUsdcMicros: string,
  requestId: string
): Promise<{ status: number; body: any }> {
  const target = userAddressOrCommitId.trim();
  const isCommit = target.startsWith("cmt_") || !isWalletAddress(target);
  const payload: Record<string, string> = { amountUsdcMicros };
  if (isCommit) {
    payload.commitId = target;
  } else {
    payload.userAddress = target;
  }

  const res = await fetch(`${BASE}/api/user/vault/report-usage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}`,
      "Content-Type": "application/json",
      "x-request-id": requestId,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Verify x-subscript-signature: t=<unix>,v1=<hmac_sha256_hex> */
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const match = header.match(/^t=(\d+),v1=([a-f0-9]{64})$/);
  if (!match) return false;
  const [, timestamp, digest] = match;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = crypto
    .createHmac("sha256", webhookSecret())
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(digest, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Produce a valid signature header for a payload (dev simulation + tests). */
export function signWebhook(rawBody: string, secret = webhookSecret()): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}
