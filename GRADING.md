# SubScript integration report card

Originally graded July 2026 while building Kris's Script, from SubScript's public site and developer
docs. Re-verified against the SubScript repo on **2026-08-19**. Almost everything this file docked
points for has since shipped, and two of its findings were wrong when written. What follows is what's
true now.

**What belongs in this file.** Anything a check can settle no longer lives here. Those claims are
assertions in `src/app/docs/__tests__/docs-quality.test.mjs`, so a regression fails a build instead
of sitting wrong in Markdown for a month. What stays here is judgment a test can't make: whether the
prose is clear, whether examples paste and run, whether the reading order builds.

## Still open

Nothing. The last item closed on 2026-08-19.

## Resolved since July

| July finding | Now |
|---|---|
| "`GET /api/v1/subscriptions/:id` to poll subscription state" | Shipped, confirmed by the merchant note of 2026-08-19. Accepts either the on-chain subscription id or the checkout id. The list now also returns `subscriptionId`, `externalReference` and `currentPeriodEnd`, and takes `?status=` and `?externalReference=` filters — so a support tool can answer "is this customer active, and until when?" without mirroring the lifecycle events. `status` is derived from the live subscription rather than the checkout, which is what made it report cancelled subscriptions as `active` indefinitely. |
| "Reconcile the subscription docs around `/api/intent`, `/api/v1/subscriptions`, `/api/v1/plans`, and `publishToDm`, with a clear when-to-use-which table" | Shipped. The endpoint-selection table is on the docs overview and in every agent surface, and it's test-enforced — the suite fails if any of the five billing models loses its row. |
| "Document the customer vault deposit flow + add `GET /api/user/vault/status`" | Shipped 2026-07-10. The usage page documents the readiness read, the commit flow with a dashboard URL to send the customer to, the `commit-config` policy endpoint, and both denial cases. |
| "Add `GET /api/intent/:id` for polling" | Shipped 2026-07-10, with the legacy `?id=` query form still supported. |
| "Add a dashboard/CLI send-test-webhook trigger" | Shipped 2026-07-18. `POST /api/webhooks/test` sends a signed sample, `POST /api/webhooks/events/replay` resends a stored event, and `npx @subscriptonarc/cli trigger` covers local loops. Sandbox test clocks simulate renewals without waiting a month. |
| "Publish a complete OpenAPI spec and `llms.txt`" | Both already existed: `llms.txt` since 2026-05-27, `/openapi.json` since 2026-06-25. See the note below. |

## What held up

The qualitative read was accurate and still is:

- The one-time path is genuinely pleasant. One endpoint, no SDK, no client-library churn, integer
  micro-USDC amounts that sidestep float bugs, idempotency keys that replay correctly.
- REST-only suits agents. Plain `fetch`, no installs, and the whole integration fits in one context
  window.
- Docs precision is the strength. Exact endpoint paths, the exact signature-header regex, raw body
  before parse, atomic event claim. An agent can implement it correctly first try, and this repo did.
- Recurring subscriptions are real and well-shaped. The lifecycle has since grown past
  `incomplete → active → canceled` to include `past_due` and `expired`, a resume
  (`subscription.reactivated`) that charges nothing and lands inside the period already paid for, and
  advance notices for renewals, trials and a spending authorization running out of cycles. Each has a
  matching webhook. The one sharp edge is that a resume mints a **new** `subscription_id`, so any
  integration keyed on that id loses the customer — `externalReference` is the key that survives.

The B+ on docs quality was fair for the prose then and the prose has only grown: the guide is now 17
routed sections, each with a plain-Markdown twin, plus the whole guide as one file at `/docs.txt`.

## Where this file was wrong, and why it matters

The "Machine-readability C+ — no OpenAPI spec, no `llms.txt` found" row was **wrong on the day it was
written.** Both surfaces were live: `llms.txt` shipped two months earlier, the OpenAPI route one
month earlier. The grade was built on an absence that wasn't there.

That's worth recording because the same mistake happened again, in the other direction, on
2026-08-19: a re-audit of these docs reported nine capabilities as undocumented and eight of the nine
were documented all along. Two causes, both cheap to avoid:

- **The docs are 17 routes, not one page.** Searching `/docs/developer` and concluding a fact is
  absent from "the docs" measures one seventeenth of them.
- **Path notation varies by surface.** The same endpoint is written `:id` in the docs pages, `{id}`
  in OpenAPI, and `[id]` in the agent files. Grep for one form and the other two read as missing.

So: absence is the hardest thing to establish by reading, and the easiest to get wrong confidently.
Anything stated as missing here should be checked against the routes on disk, not the rendered page,
and preferably turned into a failing assertion instead of a sentence in a report card.
