# Kris's Script

An AI chat platform (DeepSeek-powered) built to **field-test the [SubScript](https://subscriptonarc.com) USDC payment system on Arc** and verify its claims:

| SubScript claim | How Kris's Script tests it |
|---|---|
| One-time payments | $1 account-activation fee at signup (hosted checkout intent) |
| Subscription billing | Pro ($2/week) and Pro Max ($5/week) recurring subscriptions |
| Payment for service (metered) | "Pay as you chat" — $0.10 per message via vault `report-usage` |

Free users (including those who paid the $1 fee) get **3 messages total**, then must upgrade or enable pay-as-you-chat.

## Stack

- **Next.js 15** (App Router) + React 19
- **Postgres** — real `DATABASE_URL` in production (Neon/Supabase/etc.); embedded Postgres ([PGlite](https://pglite.dev)) in `data/pglite` locally with zero setup
- **DeepSeek** chat completions (`deepseek-chat`)
- **SubScript** REST API — checkout intents, HMAC-signed webhooks, metered usage reporting. No SDK; plain `fetch`.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in what you have (all optional for dev mode)
npm run dev                  # http://localhost:3000
```

**With no keys configured the app runs in DEV MODE**: checkout redirects to a local simulated SubScript checkout page that delivers a correctly signed `payment.succeeded` webhook to your own endpoint — so the entire billing flow (activation → caps → upgrades → metered billing → vault exhaustion) is testable offline. AI replies are stubbed until you set `DEEPSEEK_API_KEY`.

## Environment variables (`.env.local`)

| Variable | Purpose |
|---|---|
| `SUBSCRIPT_SECRET_KEY` | SubScript API key (`sk_test_` sandbox / `sk_live_` production). Blank = dev mode. |
| `SUBSCRIPT_WEBHOOK_SECRET` | Verifies `x-subscript-signature` on webhooks. |
| `DEEPSEEK_API_KEY` | Real AI replies from [platform.deepseek.com](https://platform.deepseek.com). |
| `APP_URL` | Public URL. Must be **HTTPS** for SubScript success/cancel redirects — use a tunnel in dev. |
| `AUTH_SECRET` | Signs session cookies. Set a long random string. |

## Going live against real SubScript (sandbox)

1. Create a merchant account at subscriptonarc.com → Dashboard → Developers → copy your `sk_test_` key and webhook secret into `.env.local`.
2. Expose your machine: `cloudflared tunnel --url http://localhost:3000` (or ngrok). Put the HTTPS URL in `APP_URL` and register `<url>/api/webhooks/subscript` in the SubScript dashboard.
3. Restart `npm run dev`. Checkout now goes to SubScript's real hosted page; pay with sandbox USDC on Arc.
4. For **pay-as-you-chat**: set a commit amount in Dashboard → Vault, have the customer fund their vault, then enter their Arc wallet address on the Pricing page. Each message calls `POST /api/user/vault/report-usage`; a `402` blocks chat until the vault is re-funded.

### Testing webhooks without a tunnel

```bash
npm run simulate:webhook <intent_id>   # intent id is in the checkout URL / API response
```

The script signs the payload exactly per SubScript's documented scheme (`t=<unix>,v1=HMAC_SHA256(secret, "t.body")`).

## Deploying to Vercel

1. Import the GitHub repo in Vercel (or deploy via CLI). The build needs no env vars.
2. Add a Postgres database: Vercel Dashboard → Storage → Create Database → **Neon** (free tier). Connect it to the project — `DATABASE_URL` is added automatically. Without it the app falls back to ephemeral in-function storage (fine for a quick demo; data resets between instances).
3. Set the remaining env vars in Project → Settings → Environment Variables: `SUBSCRIPT_SECRET_KEY`, `SUBSCRIPT_WEBHOOK_SECRET`, `DEEPSEEK_API_KEY`, `AUTH_SECRET`, and `APP_URL` = your production URL. Redeploy after adding them.
4. Register `https://<your-domain>/api/webhooks/subscript` in the SubScript dashboard — no tunnel needed once deployed.

## How the billing logic works

- **Fulfillment only via verified webhook** — never from the success redirect (per SubScript's own rules).
- Webhook events are **claimed atomically** (unique insert on `event.id`) so replays are acknowledged but never re-fulfilled; payments are also idempotent at the row level (verified: delivering the same payment twice does not double-extend a plan).
- Billing precedence per message: **active weekly plan → pay-as-you-chat → free cap (3)**.
- Pro = 100 messages/day; Pro Max = unlimited; renewing the same plan extends the period, switching plans starts a fresh 7 days.
- Pro / Pro Max are **real recurring subscriptions** via `POST /api/v1/subscriptions` (weekly interval). SubScript re-charges automatically and fires `subscription.renewed`, which extends access another period; `subscription.canceled` sets cancel-at-period-end. They appear as subscription objects on the SubScript merchant dashboard. The $1 activation stays a one-time checkout intent. See [GRADING.md](GRADING.md).

## Project map

```
app/api/billing/checkout   Create SubScript checkout intents ($1 / $2 / $5)
app/api/billing/payg       Enable/disable pay-as-you-chat + wallet address
app/api/webhooks/subscript HMAC verification, atomic event claim, fulfillment
app/api/chat               Message gating + DeepSeek + $0.10 usage reporting
app/api/dev/complete       Dev-mode simulated checkout completion (disabled with real keys)
lib/subscript.ts           All SubScript API calls + signature verify/sign
lib/billing.ts             Idempotent payment fulfillment
scripts/simulate-webhook.mjs  Local webhook replay tool
```
