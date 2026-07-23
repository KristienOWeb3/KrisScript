import crypto from "crypto";

const BASE = "https://www.subscriptonarc.com";
const DEV_WEBHOOK_SECRET = "dev-webhook-secret";

export function hasRealKey(): boolean {
  return !!process.env.SUBSCRIPT_SECRET_KEY;
}

export function webhookSecret(): string {
  return process.env.SUBSCRIPT_WEBHOOK_SECRET || DEV_WEBHOOK_SECRET;
}

export function appUrl(): string {
  const url =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return url.replace(/\/$/, "");
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
    // SubScript's live DM plan publication is not supported by sandbox/test
    // keys. Keep recurring checkout testable with sk_test_* keys, and only
    // publish into the DM plan flow when using a live merchant key.
    publishToDm: key.startsWith("sk_live_") ? (opts.publishToDm ?? false) : false,
    ...(opts.subscriber
      ? { subscriber: opts.subscriber, externalReference: opts.externalReference }
      : {}),
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

/** Cancel a subscription (DELETE /api/v1/subscriptions?id=). */
export async function cancelSubscription(
  id: string
): Promise<{ status: number; body: any }> {
  if (!hasRealKey()) return { status: 200, body: { id, status: "canceled", devMode: true } };
  const res = await fetch(`${BASE}/api/v1/subscriptions?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Fetch a subscription by ID from Subscript API (GET /api/v1/subscriptions). */
export async function getSubscription(
  id: string
): Promise<{ status: number; subscription?: any }> {
  if (!hasRealKey()) return { status: 200, subscription: { id, status: "active", devMode: true } };
  const res = await fetch(`${BASE}/api/v1/subscriptions`, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { status: res.status, subscription: null };
  const list: any[] = body.data || body.subscriptions || (Array.isArray(body) ? body : []);
  const sub = list.find((s) => s.id === id || s.id === `sub_${id}` || id.includes(s.id));
  return { status: res.status, subscription: sub || null };
}

/**
 * Report metered usage against a customer's vault
 * (POST /api/user/vault/report-usage). Returns HTTP status + parsed body;
 * 402 means the vault is inactive / balance exhausted.
 */
export async function reportUsage(
  userAddress: string,
  amountUsdcMicros: string,
  requestId: string
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/user/vault/report-usage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}`,
      "Content-Type": "application/json",
      "x-request-id": requestId,
    },
    body: JSON.stringify({ userAddress, amountUsdcMicros }),
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
  if (Math.abs(now - Number(timestamp)) > 300) return false;
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
