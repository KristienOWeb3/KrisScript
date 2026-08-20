# Integrating SubScript subscriptions

Written from building Kris's Script against SubScript on Arc, and re-verified against
`llms.txt`, `docs.txt` and `openapi.json` on 2026-08-20. It is aimed at the next merchant
who wires up recurring billing, and it is mostly a list of things that are not obvious from
the endpoint reference — several of which cost us real money in test.

Not affiliated with SubScript. Where this disagrees with their docs, believe theirs and tell us.

---

## The contract: four states, and only four

A customer can cause exactly four transitions that both SubScript and your platform have to
agree on. Build these and you have a working integration; everything else is bookkeeping.

| State | Arrives as | What to do |
|---|---|---|
| **Subscribed** | `subscription.activated` | Grant the tier. Set expiry from the event's `currentPeriodEnd`. |
| **Cancelled** | `subscription.cancel_scheduled`, then `subscription.canceled` | Keep access to period end. Do **not** clear the plan. |
| **Resumed** | `subscription.reactivated` | Extend to the newly stated period end. **This is charged.** |
| **Gifted** | `payment.succeeded` with `payer_address` ≠ `beneficiary_address` | Credit the beneficiary. Tell them it will not renew. |

Plus two you must handle even though the customer never sees them: `subscription.renewed`
(this is what moves the period forward — miss it and every subscriber silently lapses while
still being charged) and `subscription.payment_failed` (recoverable, not terminal).

### Where plan changes happen

**Upgrades cannot be done from the merchant–user DM.** Customers see the tiers a merchant
offers only when that merchant updates their Subscriptions section in the SubScript dashboard
by hand — there is no API that publishes into a customer's DM. The DM is a shop window.

So a tier change has to start on your own site. Set `detailsUrl` when you create a catalogue
plan and the dashboard entry can link back to you; the customer checks out on your platform,
and *because you initiated that checkout* you can retire the subscription it replaces. A
switch made anywhere else leaves you with two live authorizations and no idea it happened.

Cancel and resume, by contrast, work fine from the DM — they arrive as ordinary webhooks.

---

## Things that will bite you

### A resume is charged. There is no free revival.

Nothing in the docs promises access continues untouched when a customer resumes, and in
practice the plan's regular price is debited again. The only resubscribe primitive SubScript
exposes (`resubscribePlanId`, on a sponsorship DM) points at minting a **new** checkout.

We assumed the opposite, in a confident code comment, and shipped a handler that took the
money and extended nothing. Subscribers paid and got no additional access.

The robust fix does not require knowing which way it goes: **extend only to the period end
the event states.** Nothing stated means nothing moves, so you cannot over-grant a genuinely
free resume or under-grant a charged one.

```js
const stated = toEpochSeconds(data.current_period_end_timestamp ?? data.current_period_end);
// COALESCE, so an absent value leaves the existing expiry alone
```

### An upgrade is a new subscription, and the old one keeps charging

There is no `PATCH /api/v1/subscriptions`, and `PATCH /api/v1/plans` only touches `active`,
`description` and `detailsUrl` — price and period are immutable. So a tier change means a new
subscription with a **new id and the same customer id**, and each subscription is an
independent on-chain authorization. Two active records for one customer are two charges.

Order matters: grant the new tier, *then* cancel the old authorization. Cancelling first
leaves the customer with nothing if they abandon the checkout.

There is a second failure here that is easy to miss: the stale subscription's next
`subscription.renewed` still resolves to your customer, so an un-retired old subscription
will drag their tier back down a month later.

Plan changes are also **upgrade-only** — "do not build or expose a downgrade action." The way
down is cancel, then subscribe to the lower tier once the period ends.

### Key entitlement on your own reference, never on the subscription id

`subscription_id` changes on both a resume and an upgrade. `externalReference` (echoed back as
`merchant_customer_id`) is the only stable handle on a customer.

**Do not put the tier in it.** We used `user:<id>:plan:<tier>`, which changes identity on
exactly the event the reference exists to survive. Use `user:<id>` and recover the tier from
the charged amount, or from your own record of what the checkout was for.

### `subscriber` and `externalReference` travel together

`subscriber` becomes mandatory whenever `externalReference` or `merchantCustomerId` is sent.
Send a reference without an address and the request 400s with "invalid subscriber address",
which is easy to surface as a generic failure and then spend an afternoon on.

If you do not want to ask customers to paste a wallet address, send **neither** on their first
checkout. It still resolves — record the returned checkout id and match on that — and the
activation event carries `subscriber` back, so you can file the address and send both from
then on. `subscriber` is also what makes SubScript write the DM plan offer.

### `publishToDm` omitted does not mean off

SubScript publishes unless it receives a **literal `false`**. Omitting the field opts you in.

Also: publishing per-checkout is almost never what you want. A checkout is one customer
starting one subscription, not a catalogue entry, and publishing each one fills the catalogue
with a throwaway plan per attempt — abandoned ones included. Create plans once with
`POST /api/v1/plans` and subscribe by `planId`.

That endpoint accepts **no idempotency key** and does **not** deduplicate on `name`, so record
the returned id yourself and never blindly re-post. A duplicate in a public catalogue is
permanent.

### `payment.succeeded` carries none of your identifiers

Its `data` is `intent_id`, `checkout_session_id`, `amount`, `amount_usdc_micros`, `currency`,
`receipt_id`, `transaction_hash`, `payer_address`, `beneficiary_address`, `chain_id`,
`usdc_address`, `explorer_url`. No `external_reference`, no `merchant_customer_id` — those
exist only on subscription events.

For a payment you initiated, match on `intent_id`. For a **gift**, which you did not initiate
and have no row for, `beneficiary_address` is the only key you get — so sponsorship can only
resolve for a customer whose address you already hold.

### Get the field names right

The address fields are `payer_address` and `beneficiary_address`. We wrote a helper that
mapped snake_case to camelCase and then looked up `beneficiary`, which matched nothing on
every real delivery — a silently dead code path that also never captured a wallet address.

Worth knowing which is which: `beneficiary_address` is the account to fulfill;
`payer_address` is the wallet that signed. **Never write the payer's address onto the
beneficiary's account** — on a gift they are different people, and an absorbed stranger's
address will route that customer's future DM offers to the wrong person.

### Gifts are one-time payments, so say so

A gift buys one duration and leaves no standing authorization. The account looks identical to
a paying subscriber right up to the moment it lapses, so surface it: who paid, when it ends,
and that it will not renew.

Extend from `max(now, current_expiry)`, not from now — a gift to someone mid-period should add
time, not truncate it. If they already have their own live subscription, the gift is just extra
time and there is nothing to warn about.

`isSponsored`, `sponsoredPlanId`, `sponsoredPlanName` and `durationSeconds` appear in the prose
guide but **not** in `openapi.json`, and sponsor workflows are flagged deployment-scoped. Read
them when present; never depend on them. Two differing addresses is the fact that is actually
in the contract.

### The "Ask a Friend" request side may not be callable

`POST /api/user/requests/merchant-plan` sits under `/api/user/…`, not the merchant `sk_`
routes, so it is user-session-authed rather than something your backend can call with a secret
key. Response shape, auth, idempotency, expiry and revocation are all undocumented. Build the
fulfillment half — it is cheap and safe — and let customers initiate from their own DM.

---

## Fulfillment hygiene

- **Only ever fulfill from a verified webhook.** A hit on your success URL proves someone
  loaded a page, nothing more. We once accepted `{"status":"success"}` POSTed to the return
  endpoint, which was enough to activate a paid plan for free.
- **Verify before parsing.** Read the raw body, check
  `x-subscript-signature: t=<unix>,v1=<hex>` as `HMAC_SHA256(secret, "${t}.${rawBody}")`, then
  parse.
- **Claim `event.id` under a UNIQUE constraint** before doing any work. `subscription.renewed`
  arrives every period and deliveries retry, so a non-idempotent extension hands out free
  months.
- **Be generous with the signature timestamp window.** Providers retry by re-POSTing a payload
  they already signed, so a tight window makes every retry after the cutoff permanently
  unverifiable — a queue stuck for an hour can never drain. Replay safety should come from the
  event-id claim, not the clock.
- **Also pull, do not only listen.** `GET /api/intent/:id` and
  `GET /api/v1/subscriptions?externalReference=` let you ask instead of waiting. A stalled
  queue on the provider side left genuinely paid charges unfulfilled here for weeks.
- **Fail closed.** Unknown status, unreachable API, or an amount that disagrees with what you
  recorded — leave it pending. Verify the amount before granting; without that, a cheap
  intent can be pointed at an expensive entitlement.
- **Refuse cross-environment deliveries.** Events carry `environment` / `livemode`. A TEST
  event reaching a live deployment would grant a real plan for a sandbox charge. Return 4xx so
  it surfaces as the misconfiguration it is.
- **Read `data.object`**, and accept snake_case and camelCase — real deliveries send both
  spellings of every field.
- **`incomplete` is not a failure** and `past_due` is not terminal. Do not revoke on either
  without a policy.

## Testing

- Sandbox **test clocks** simulate renewals without waiting a month:
  `POST /api/test/clocks`, `/{id}/subscriptions`, `/{id}/advance` (`{days}`; max 365 days and
  50 events per call, `sk_test_` keys only). Deliveries are properly signed and carry
  `simulated: true`.
  Caveat: a clock subscription accepts only a name, amount, interval and `subscriberLabel` —
  **no `externalReference`** — so its renewals cannot map to a real account. They prove
  delivery and verification, not fulfillment.
- Webhooks cannot reach `localhost`. Use a tunnel, and remember a gift has no pull path at all,
  since reconciliation only polls rows you created.
- Publish catalogue plans from an HTTPS URL. `detailsUrl` is rejected over plain http and
  cannot be added later.

## One meta-lesson

The docs are 17 routed sections plus `llms.txt`, `docs.txt`, `llms-full.txt` and
`openapi.json`, and **they do not always agree.** We twice concluded a capability was missing
by searching one surface. Path notation also varies — `:id` in the guide, `{id}` in OpenAPI,
`[id]` in the agent files — so grepping one form makes the other two look absent.

Absence is the hardest thing to establish by reading and the easiest to get wrong
confidently. Check the OpenAPI spec, then check behaviour in sandbox, before building on the
belief that something does not exist.
