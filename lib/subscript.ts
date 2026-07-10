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
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
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
    throw new SubScriptError(
      json.message || json.error || `SubScript /api/intent failed (HTTP ${res.status})`,
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

/**
 * Report metered usage against a customer's vault
 * (POST /api/user/vault/report-usage). Returns HTTP status + parsed body;
 * 402 means the vault is inactive / balance exhausted.
 */
export async function reportUsage(
  userAddress: string,
  amountUsdc: string
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/user/vault/report-usage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUBSCRIPT_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userAddress, amountUsdc }),
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
