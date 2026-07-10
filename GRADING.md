# SubScript Integration Report Card

Graded while building Kris's Script (July 2026), based on SubScript's public site + developer docs and implementing all three advertised payment methods. **Caveat:** graded from documentation and a full local integration; live sandbox execution still requires a merchant API key (see README "Going live").

## Claim verification

| Claim | Verdict | Evidence |
|---|---|---|
| **One-time payments** | ✅ True | `POST /api/intent` → hosted checkout → HMAC-signed `payment.succeeded` webhook. Fully documented with field tables, error codes, idempotency, and sandbox mode. |
| **Subscription billing** | ⚠️ Partially true | The homepage advertises recurring billing, but the docs admit traditional fixed-schedule subscriptions are **"planned but not yet live."** Recurring today = "metered vaults" (escrow + usage accrual + 30-day keeper settlement). Kris's Script had to fake weekly plans as one-time intents granting 7-day access. |
| **Payment for service (usage-based)** | ⚠️ Half documented | Merchant side is clean (`POST /api/user/vault/report-usage`, `402` when exhausted). But the **customer-side vault deposit flow is undocumented** — no hosted deposit page, no wallet-connect flow, no `GET` endpoint to check a customer's vault status. You can bill usage but can't onboard the payer from docs alone. |

## Grade: Human developers — **B**

| Area | Grade | Notes |
|---|---|---|
| One-time checkout API | A− | Stripe-like mental model: intent → redirect → webhook. Integer micro-USDC amounts avoid float bugs. Idempotency keys replay correctly (200 vs 201). |
| Docs quality | B+ | Excellent field tables, copy-pasteable webhook verification code, error-code table with `request_id`, go-live checklist. |
| Webhooks | B+ | Standard `t=…,v1=…` HMAC scheme, replay window, retry semantics all specified. Missing: a CLI/dashboard "send test event" trigger (Stripe's `stripe trigger` equivalent), so local testing requires a tunnel or hand-rolled simulator. |
| Subscriptions | D | Advertised on the homepage, not shipped as an API. The vault workaround is a different product with different UX. |
| Usage-based billing | C | Server API is simple, but the payer onboarding half of the flow is missing from docs. No vault status `GET`, no documented deposit URL. |
| Observability | C+ | No documented `GET /api/intent/:id` to poll payment state — you are webhook-or-nothing. Aged-PENDING alerting is left to you. |

**Overall: B.** The one-time payment path is genuinely pleasant — arguably easier than Stripe for the happy path (one endpoint, no SDK, no client library version churn, 1% flat fee). It loses a full letter grade for advertising subscriptions that don't exist yet as an API, and for the half-documented vault flow.

## Grade: AI agent developers — **B+**

| Area | Grade | Notes |
|---|---|---|
| REST-only, no SDK | A | Perfect for agents: plain `fetch`, no package installs, no SDK version drift. Everything fits in one context window. |
| Docs precision | A− | Exact endpoint paths, exact regex for the signature header, exact payload shapes, explicit "critical rules" (raw body before parse, atomic event claim). An agent can implement this correctly first-try — this repo did. |
| Self-verifiability | C | An agent **cannot close the loop alone**: no sandbox "trigger webhook" API, no intent status `GET` to poll, and receiving real webhooks needs a human to set up a tunnel + dashboard webhook registration. Kris's Script had to build its own signed-webhook simulator to test end-to-end. |
| Machine-readability | C+ | No OpenAPI spec, no `llms.txt` found. Field tables are prose-parsed. |
| Undocumented gaps | C | Where docs are silent (vault deposits, commit-config fields), an agent must guess or stop; a human can email support. |

**Overall: B+.** Where SubScript is documented, it may be one of the most agent-friendly payment APIs around — the docs read like they were written for LLMs (single page, exact regexes, copy-paste crypto code). The score drops on self-verifiability: agents need a way to trigger sandbox events and poll payment status without human dashboard work.

## What SubScript should fix

1. Ship (or stop advertising) fixed-schedule subscriptions.
2. Document the customer vault deposit flow + add `GET /api/user/vault/status`.
3. Add `GET /api/intent/:id` for polling.
4. Add a dashboard/CLI "send test webhook" button.
5. Publish an OpenAPI spec and `llms.txt`.
