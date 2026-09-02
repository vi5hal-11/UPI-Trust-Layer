# UPI Agent Trust Layer — project context

Claude Code reads this file automatically. It keeps every session working to the
same invariants.

---

## What this is

A policy gatekeeper between an AI shopping agent and Razorpay's payment APIs.
Spend caps, category rules and step-up confirmation are enforced in
deterministic code, and every decision is written to an append-only audit trail.

Built for the Razorpay AI Buildathon, Track 01 (Growth & Agentic Commerce).
Deadline: **5 September**. Scope discipline matters more than feature count.

## The one rule that governs every design decision

> **The LLM never touches Razorpay.**

The agent's entire capability surface is one tool:
`attempt_purchase(item, amount_inr, category, merchant?)`. It has no Razorpay
key, no endpoint, no import path to the payment client, and no route to approve
its own step-up.

A prompt is not a security boundary. If "don't spend over ₹2,000" lives only in
a system prompt, it holds until the first jailbreak or confused tool call. So:
the model may request anything; a pure function decides; the decision is
identical every time.

When any change is proposed, the test is: *does this let the model influence the
money path in a way that isn't deterministic and logged?* If yes, reject it.

## Locked decisions — do not re-litigate

| Decision | Choice | Why |
|---|---|---|
| Server stack | Node 20+ / TypeScript, ESM, `tsx` (no build step) | Reuses existing agent-orchestration patterns; no compile step during a 4-day build |
| Dashboard stack | React 19 + Vite + Tailwind v4 + Radix + `motion/react` | Deliberate reversal of the original "single file, no build" rule, made on 2 Sept for a richer judge-facing UI. `npm start` runs the build first (`prestart`), so a fresh clone still only needs `npm install && npm start` |
| Razorpay access | Direct REST via the official SDK, behind the gatekeeper | MCP would hand the agent payment tools — exactly what this project argues against |
| Step-up channel | Button in the dashboard, not SMS/webhook | The policy re-check is real; the notification channel is out of scope and disclosed |
| Mandate | AP2-*shaped* (scoped, expiring, tamper-evident) with SHA-256 integrity, not signature verification | Honest simplification, stated in the README |
| Audit store | SQLite, append-only | Credible, zero-config, and evidence-shaped |
| Persistence of intent | Never update or delete a row | A resolution is a new event pointing back at the one it resolves |

## Architecture

```
user ──▶ Shopping Agent (LLM) ──▶ [ attempt_purchase ] ──▶ Gatekeeper ──▶ Razorpay
              no keys, no rails         the only door      deterministic    test mode
                                                                 │
                                                                 ▼
                                                         Append-only audit trail
                                                                 │
                                                                 ▼
                                                          Audit dashboard
```

```
src/
  types.ts                  zod schemas + shared event/decision types
  config/
    env.ts                  loads .env once; everything reads config from here
    policy.default.json     the mandate in force
  gatekeeper/
    policyEngine.ts         pure function — the entire trust boundary. No I/O.
    mandate.ts              load, expiry check, integrity hash
    service.ts              orchestration: decide → pay → log
  razorpay/client.ts        the ONLY module that may import the Razorpay SDK
  audit/store.ts            append-only SQLite audit trail
  agent/shoppingAgent.ts    Claude tool-use loop, exactly one tool exposed
  server/index.ts           Express API + static dashboard
dashboard/
  index.html                Vite entry; sets the theme class before first paint
  src/
    App.tsx                 layout, segmented filter, toasts
    lib/motion.ts           the ONLY source of durations, easings, springs
    lib/api.ts              types mirroring GET /api/state
    components/             Header, MandateCard, BudgetCard, EventRow, Backdrop
  dist/                     build output, gitignored, served by Express
scripts/
  demo-scenarios.ts         the four demo scenarios
  check-secrets.ts          pre-push credential scan (npm run check:secrets)
tests/
  e2e/                      Playwright: the demo path, run by `npm run test:e2e`
    demo-path.spec.ts       5 tests - block, rail, filter, step-up, toast
    pages/DashboardPage.ts  page object; role/text selectors over CSS
    tsconfig.json           browser env - cannot share the server's NodeNext
  policyEngine.test.ts      24 tests, including the adversarial ones
  auditStore.test.ts        18 tests — what counts as spend, append-only
  gatekeeper.test.ts        23 tests — zero-rail-calls, approval re-check
  agentIsolation.test.ts     3 tests — the LLM has no path to the rail
```

## Invariants — every one of these needs a test

1. **A hard violation beats a step-up.** If a purchase both breaks a rule and
   exceeds the approval threshold, it is *blocked*, never parked. Otherwise a
   human can be socially engineered into approving what the mandate forbids.
2. **Step-up is re-evaluated at approval time, not request time.** The month's
   spend moves while a request sits parked; a stale approval must not overspend
   the cap.
3. **All violations are collected, not just the first.** The blocked-purchase
   demo depends on showing three reasons at once.
4. **Deny list beats allow list.** Always.
5. **Only money that moved counts as spend.** `allowed` and `step_up_approved`
   count. `blocked`, `step_up_required`, `step_up_denied` and `payment_failed`
   never touch the budget.
6. **`payment_failed` is its own decision.** Policy said yes but the rail
   failed — that must not read as a successful purchase, and must not count as
   spend.
7. **Every agent-produced object is validated before it reaches the policy
   engine.** Malformed input is logged as a blocked event, never crashes the
   request.
8. **Test-mode keys only.** Refuse to start if `RAZORPAY_KEY_ID` doesn't begin
   with `rzp_test_`.
9. **Mock mode must work with zero credentials.** With no keys set, decisions
   are real and only the final Razorpay call is stubbed, clearly labelled as
   mock.

## Conventions

- `policyEngine.evaluate()` stays pure — no database, no network, no clock of
  its own (`now` is passed in). It is the most-tested file in the repo.
- Decision `reason` strings are written for a **non-technical reader**, in
  rupees with Indian grouping (`₹15,000`). These strings are what a judge
  actually reads in the video.
- Machine-readable `violations[]` codes travel alongside the prose reason so the
  dashboard can style them.
- Errors say what happened and what to do next. No silent catches.
- Every new rule gets a test before it gets a UI.

## Definition of done

- `npm test` green (68 tests), `npm run typecheck` clean (checks the server,
  the dashboard, and the E2E suite as three separate TypeScript projects —
  they have genuinely different module resolution and cannot share one).
- `npm run test:e2e` green (5 Playwright tests, chromium only). Deliberately
  NOT part of `npm test`: it needs a build, a browser and a running server,
  and the fast unit loop must stay fast. It starts the server itself and
  reuses one already running. The suite shares the append-only audit trail, so
  the step-up test reads the live budget first and skips — rather than fails —
  once repeated runs have consumed the monthly cap. `npm run demo` resets it.
- Vitest config lives in `vitest.config.ts`, deliberately separate from
  `vite.config.ts` — the latter sets `root: 'dashboard'` and would otherwise
  make Vitest look for the server suite in the wrong directory.
- `npm run demo` runs all four scenarios end to end with no API keys set.
- `npm start` serves a dashboard where a stranger can tell, in ten seconds, what
  was allowed, what was blocked, and why.
- README opens with the NPCI UAP / Feb 2026 Razorpay pilot grounding, and has an
  honest "what I deliberately did not build" section.
- Public repo, no secrets committed, `.env.example` only. `npm run check:secrets`
  before every push.
