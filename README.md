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
- **Postgres** — required `DATABASE_URL` in production (Neon/Supabase/etc.); embedded Postgres ([PGlite](https://pglite.dev)) in `data/pglite` locally with zero setup
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
| `APP_URL` | Public URL. Must be **HTTPS** for SubScript success/cancel redirects and for webhooks to reach you at all — use a tunnel in dev. |
| `AUTH_SECRET` | Signs session cookies. Set a long random string. |
| `ADMIN_RESET_SECRET` | Guards `/api/admin/reset` and `/api/admin/bootstrap-plans`. Unset disables both. Required for `npm run plans:bootstrap`. |

## Going live against real SubScript (sandbox)

1. Create a merchant account at subscriptonarc.com → Dashboard → Developers → copy your `sk_test_` key and webhook secret into `.env.local`.
2. Expose your machine: `cloudflared tunnel --url http://localhost:3000` (or ngrok). Put the HTTPS URL in `APP_URL` and register `<url>/api/webhooks/subscript` in the SubScript dashboard.
3. Restart `npm run dev`. Checkout now goes to SubScript's real hosted page; pay with sandbox USDC on Arc.
4. For **pay-as-you-chat**: set a commit amount in Dashboard → Vault, have the customer fund their vault, then enter their Commit ID on the Pricing page. Each message calls `POST /api/user/vault/report-usage`; a `402` blocks chat until the vault is re-funded.

### Testing webhooks without a tunnel

```bash
npm run simulate:webhook <intent_id>   # intent id is in the checkout URL / API response
```

The script signs the payload exactly per SubScript's documented scheme (`t=<unix>,v1=HMAC_SHA256(secret, "t.body")`).

## Deploying to Vercel

1. Import the GitHub repo in Vercel (or deploy via CLI). The build needs no env vars.
2. Add a Postgres database: Vercel Dashboard → Storage → Create Database → **Neon** (free tier). Connect it to the project — `DATABASE_URL` is added automatically. This is required: without a durable database, a payment webhook can succeed in one serverless invocation while `/chat` later reads a fresh empty database.
3. Set the remaining env vars in Project → Settings → Environment Variables: `SUBSCRIPT_SECRET_KEY`, `SUBSCRIPT_WEBHOOK_SECRET`, `DEEPSEEK_API_KEY`, `AUTH_SECRET`, and `APP_URL` = your production URL. Redeploy after adding them.
4. Register `https://<your-domain>/api/webhooks/subscript` in the SubScript dashboard — no tunnel needed once deployed.

## How the billing logic works

- **Fulfillment only via verified webhook** — never from the success redirect (per SubScript's own rules).
- Webhook events are stored with processing state and marked processed only after fulfillment succeeds, so replays are acknowledged and transient failures can retry safely; payments are also idempotent at the row level.
- Billing precedence per message: **active monthly plan → pay-as-you-chat → free cap (3)**.
- Pro = 10 messages/month, Pro Max = 25, Ultra = 50. Switching tiers starts a fresh period; renewing is SubScript's job.
- The tiers are **real recurring subscriptions** via `POST /api/v1/subscriptions` with `interval: "monthly"` and an `externalReference` of `user:<id>`. The $1 activation and the $1 name change stay one-time checkout intents. See [GRADING.md](GRADING.md).
- **The subscriber's address is never asked for — it is learned.** SubScript requires `subscriber` whenever an `externalReference` or `merchantCustomerId` is sent, so the two travel together or not at all. An account's *first* checkout sends neither: the customer connects their wallet on SubScript's hosted checkout, and the activation event carries `subscriber` back, which `handleSubscriptionEvent` files onto `users.wallet_address`. That first checkout still resolves without a reference, because the payments row records the checkout id and `resolveSubscriptionSubject` falls back to it. Every later checkout carries both — and with them the key that survives a resume, and the DM plan offer, which SubScript only writes when it receives a `subscriber`.
- **The customer reference carries no tier.** A tier change mints a *new* subscription id but keeps the same customer id, so a reference like `user:<id>:plan:pro` would change identity on every upgrade — which is the one thing the reference exists to prevent. The tier is recovered from the charged amount instead (the three prices are distinct). The older per-tier form is still parsed, since live subscriptions carry it.
- **Plan catalogue / DM publication is always on.** Every plan checkout sends `publishToDm: true`, sent as a literal rather than omitted so the intent is readable and does not rest on SubScript's default. It was conditional twice before and failed closed both times — first on a live-key gate (test keys can publish too; the premium requirement is waived for test mode), then on an env var no deployment had set — and each time the symptom was plans never reaching the DM flow with nothing explaining why. Run `npm run plans:bootstrap` once to publish the three tiers as catalogue plans; checkouts then subscribe by `planId`. Without that, every checkout mints its own ad-hoc plan and the DM picker fills with duplicates. **Note for mainnet:** a published plan carries no environment of its own and no plan query filters on one, so a test-key plan is listed in the same public catalogue as live plans. Fine on testnet; re-gate before mainnet.
- `users.wallet_address` holds **only** `0x` addresses; vault commit ids live in `users.commit_id`. They shared a column until the split, which is why subscriptions had no address to bind to. The address is now populated from subscription events rather than typed in — only the Commit ID is still entered by hand, because metered billing has no event to learn it from.
- Subscription events handled: `activated`, `updated`, `renewed`, `reactivated`, `cancel_scheduled`, `canceled`, `payment_failed`, `renewal_upcoming`, `trial_ending`, `allowance_low`. **A resume mints a new `subscription_id`** and names the old one in `previous_subscription_id`, so entitlements are keyed on our own `externalReference` (returned as `merchant_customer_id`) and never on the subscription id.
- **A resume is charged, not free.** SubScript documents no free revival — the only resubscribe primitive it exposes points at a new checkout at the regular price — and in practice the same amount is debited. `reactivated` therefore extends `plan_expires_at` to the period end the event states. It extends *only* to a stated end, which is safe in both directions: nothing stated means nothing moves. The previous code asserted the opposite and never extended, so a subscriber paid and received no additional access.
- **Cancelling writes `sub_status = 'canceling'`, not `'canceled'`.** Access runs to period end, and the terminal value arrives from the event. Writing it locally made a winding-down subscription indistinguishable from a finished one — which, combined with `/api/billing/checkout` refusing the current tier while `planIsActive` was still true, made resubscribing impossible from the platform at all.

### Upgrading a plan

Entirely platform-initiated; there is no DM upgrade path. Click a higher tier on `/pricing` → `POST /api/billing/checkout` creates a **new** subscription and hands back SubScript's hosted `checkoutUrl` → pay there → `subscription.activated` grants the new tier → the subscription it replaced is cancelled.

- **Order matters.** The old authorization is cancelled *after* the new one activates, never before, so an abandoned checkout cannot leave the subscriber with nothing.
- Two active subscriptions for one subscriber are **two chargeable authorizations**, so failing to retire the old one double-bills — and its next renewal would drag the tier back down. The outgoing id is parked on `payments.supersedes_subscription_id` at checkout.
- There is a fallback for a tier change we did not initiate (no payments row to carry the supersede): the id the account held before the event is retired when the tier actually changed. We don't expose that path, but it stops a DM-side tier change from billing twice.
- **No proration.** SubScript documents none, so an upgrade charges the new tier's full price immediately and starts a fresh period. Unused days on the old tier are not credited.
- **Upgrade-only while live**, per SubScript: "do not build or expose a downgrade action." Lower tiers are hidden on `/pricing` while a subscription is live. The way down is cancel, then subscribe to the lower tier — once it is winding down, every tier is offered again, because the next checkout starts a fresh authorization rather than editing one.

### Gifted plans ("ask a friend to pay")

A gift is detected, recorded, and **surfaced to the subscriber** — because a gifted account otherwise looks identical to a paying one right up to the moment it silently lapses.

- Detection: `payment.succeeded` carries `payer_address` and `beneficiary_address`, and two different addresses mean a third party paid. `isSponsored` is read when present but never required — it appears in SubScript's prose guide and **not** in `openapi.json`, and sponsor workflows are flagged deployment-scoped.
- **The only key is `beneficiary_address`.** `payment.succeeded` carries no `external_reference` or `merchant_customer_id` at all, and a gift has no payments row of ours to match, so the beneficiary is resolved via `users.wallet_address`. Sponsorship therefore only works for an account whose address is already on file — which now means one that has completed at least one subscription checkout, since that is where the address is learned. A gift to an account that has never paid has nothing to resolve against and logs as `beneficiary_not_registered`.
- A gift settles as a **one-time payment**: one duration, no standing authorization, so it will not renew. `users.plan_gifted` is set, `sub_status` becomes `gifted`, and `/api/me` returns a `giftNotice` naming the payer and the end date. `/pricing` and `/chat` both show it, and the tier card offers *Subscribe* rather than *Cancel* — there is nothing to cancel.
- Where the beneficiary already has a live subscription of their own, the gift is just extra time: the period extends and nothing is flagged, because nothing is going to stop.
- Extending uses the event's `duration_seconds` when stated, from whichever is later of now and the current expiry — so a gift mid-period adds time instead of truncating it.
- **The request side is not built.** `POST /api/user/requests/merchant-plan` sits under `/api/user/…` rather than the merchant `sk_` routes, so it is user-session-authed and not callable with our key; its response shape, idempotency, expiry and revocation are all undocumented. Subscribers ask from their own SubScript DM. `/pricing` offers each tier's `subscribeUrl` as a **Share with a friend** link, which is SubScript's own hosted checkout for that plan.
- Deliveries are read from `data.object`, accepted in either snake_case or camelCase, and refused with a 400 when the event's `environment` disagrees with the configured key.

### Demoing the subscription lifecycle

Webhooks cannot reach `localhost`, so `APP_URL=http://localhost:3000` means **no deliveries at all** — and a gift has no pull path, since `reconcilePendingPayments` only polls payments rows we created. Start a tunnel first:

```bash
cloudflared tunnel --url http://localhost:3000   # put the HTTPS URL in APP_URL
# register <url>/api/webhooks/subscript in the SubScript dashboard, then restart dev
npm run plans:bootstrap    # publish the three tiers once (idempotent)
npm run plans:check        # show local + upstream catalogue, publish nothing
```

Renewals without waiting a month, via sandbox test clocks:

```bash
npm run clock create
npm run clock add <clockId>
npm run clock advance <clockId> 31
```

Test-clock subscriptions accept only a name, amount, interval and `subscriberLabel` — **no `externalReference`** — so their renewals carry none of our identifiers and log as `user_not_found`. They prove signed deliveries arrive and verify. To extend a *real* account's period, use the dev simulator with the subscription's checkout id and `eventType: "subscription.renewed"`; its gift checkbox exercises the `payer_address` / `beneficiary_address` split.

## Project map

```
app/api/billing/checkout   Create subscription checkouts + the plan catalogue (GET)
app/api/billing/payg       Enable/disable pay-as-you-chat + save the Commit ID
app/api/admin/bootstrap-plans  Publish the three tiers as SubScript catalogue plans (idempotent)
app/api/webhooks/subscript HMAC verification, atomic event claim, fulfillment
app/api/chat               Message gating + DeepSeek + $0.10 usage reporting
app/api/dev/complete       Dev-mode simulated checkout completion (404s in production)
lib/subscript.ts           All SubScript API calls + signature verify/sign
lib/billing.ts             Idempotent payment fulfillment, subscription lifecycle, gifts
scripts/bootstrap-plans.mjs   Publish/inspect the catalogue plans
scripts/test-clock.mjs        Sandbox test clocks — renewals without waiting a month
scripts/simulate-webhook.mjs  Local webhook replay tool
```
