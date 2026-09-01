# UPI Agent Trust Layer

**A deterministic policy gatekeeper between an AI shopping agent and Razorpay.**
Spend caps, category rules and human approval are enforced in code, not in a
prompt, and every decision — allowed or not — is written to an append-only audit
trail.

Built for the Razorpay AI Buildathon, Track 01 (Growth & Agentic Commerce).

```bash
npm install
npm run demo     # four scenarios, no API keys needed
npm start        # dashboard on http://localhost:3000
```

---

## The problem

AI agents can already pay. NPCI has been developing a **UPI Agentic Payments**
framework so that an agent can transact on a user's behalf under a pre-approved
mandate, and in **February 2026** Razorpay and NPCI ran a live agentic-UPI pilot
with Zomato, Swiggy and Zepto — real users, real money, an agent completing the
checkout.

What does not exist yet is the layer in between. A mandate says *this agent may
spend up to X*. It does not say what happens when the model, mid-conversation,
decides a ₹15,000 keyboard is a reasonable grocery run — or when someone
persuades it to.

The usual answer is to put the rules in the system prompt. That holds until the
first jailbreak, the first confused tool call, or the first model upgrade.

**A prompt is not a security boundary.** This project is the argument that the
boundary belongs in deterministic code, on the other side of the model, with a
log.

> Verify the NPCI UAP status and the February 2026 pilot against current
> reporting before quoting them — this framing is what the project is built on,
> not a claim it proves.

---

## The one rule

> **The LLM never touches Razorpay.**

The agent's entire capability surface is one tool:

```
attempt_purchase(item, amount_inr, category, merchant?)
```

It has no Razorpay key, no endpoint, no import path to the payment client, and
no route to approve its own step-up. The model may *ask* for anything. A pure
function decides. The decision is identical every time.

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

That isolation is asserted, not just described. `tests/agentIsolation.test.ts`
puts a **live** `rzp_live_` key in the environment and imports the agent module.
The Razorpay client refuses to load at all on a non-test key — so if the agent
had any runtime path to it, the import would throw. It doesn't. The same test
then imports the gatekeeper service under the identical environment and watches
it refuse, so the first half cannot pass vacuously.

---

## What the gatekeeper enforces

Every rule below is a test before it is a feature.

| Rule | Behaviour |
|---|---|
| Per-transaction cap | ₹2,000. Over it → blocked. |
| Rolling monthly cap | ₹10,000. Counts only money that actually moved. |
| Category deny list | electronics, travel, gift-cards. **Deny always beats allow.** |
| Category allow list | groceries, subscriptions, accessories, household. Empty list means "anything not denied". |
| Step-up threshold | ₹1,500 and above needs a human. Inclusive. |
| Mandate expiry | Past `expires_at` → blocked. |
| Mandate integrity | SHA-256 over canonical JSON of `{principal, scope}`. Edited scope → blocked. |

And the properties that are easier to get wrong than to state:

1. **A hard violation beats a step-up.** Something both forbidden *and* large is
   blocked outright, never parked — otherwise a human can be socially engineered
   into approving what the mandate forbids.
2. **Step-up is re-evaluated at approval time.** The month's spend moves while a
   request sits waiting. Approving a purchase parked before the budget ran out
   does not pay; it logs a block saying the approval arrived too late.
3. **All violations are collected**, not just the first. ₹15,000 of electronics
   returns three reasons in one pass.
4. **An untrustworthy mandate is the whole answer.** Expired or tampered
   short-circuits: the engine will not check a request against limits it has
   just decided are forged. (This one came out of a failing test — see
   `NOTES.md`.)
5. **Only money that moved counts as spend.** `allowed` and `step_up_approved`
   count. `blocked`, `step_up_required`, `step_up_denied` and `payment_failed`
   never touch the budget.
6. **`payment_failed` is its own decision.** Policy said yes, the rail failed.
   Not a purchase, not spend, and the agent is told in words not to report it as
   success.
7. **Everything the model produces is validated** with zod before it reaches the
   policy engine. Malformed input is a logged blocked event, never a crash.
8. **Test-mode keys only.** The app refuses to start if `RAZORPAY_KEY_ID` is not
   an `rzp_test_` key.

---

## Running it

Nothing below requires an API key.

```bash
npm install
npm run demo        # the four scenarios, against a fresh database
npm start           # dashboard at http://localhost:3000
npm test            # 68 tests
npm run typecheck
```

With no Razorpay keys the app runs in **mock mode**: every policy decision is
real and really logged, and only the final call to Razorpay is stubbed — the
order id says `order_MOCK_…` so it can never be mistaken for a real one.

To create real Razorpay **test-mode** orders, copy `.env.example` to `.env` and
set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. To put a real LLM in front of the
gatekeeper, set `ANTHROPIC_API_KEY` and run `npm run demo:agent`.

Poking at it directly:

```bash
curl -X POST localhost:3000/api/intent -H 'content-type: application/json' \
  -d '{"item":"gaming keyboard","amount_inr":15000,"category":"electronics"}'
```

---

## The four scenarios

`npm run demo` runs these against a fresh database and prints what happened.

| # | Purchase | Decision | Why it is in the demo |
|---|---|---|---|
| 1 | ₹800 protein powder, groceries | **paid** | The ordinary path works. |
| 2 | ₹15,000 gaming keyboard, electronics | **blocked** | Three rules at once, and **zero** Razorpay calls — counted and printed, not asserted in prose. |
| 3 | ₹1,200 phone stand, accessories | **paid** | Recovery. Logged as a retry of the block it followed. |
| 4 | ₹1,800 subscription | **parked → paid** | A human approves; policy is re-checked before any money moves. |

Ending state: 5 decisions logged, **₹3,800** actually spent of the ₹10,000 cap,
**₹15,000** stopped by policy, and **3** calls to Razorpay — one per purchase
that policy allowed, none for the block.

The blocked scenario is the one that matters. If you only watch one thing, watch
that the Razorpay dashboard stays empty after it.

---

## What I deliberately did not build

Stated plainly, because a demo that volunteers its own limits is easier to trust
than one that doesn't.

- **Razorpay's MCP server.** It would have been the fast path, and it is exactly
  what this project argues against: MCP hands the model payment tools directly.
  The whole thesis is that the model gets one tool and no rails. So the
  integration is the plain REST SDK, behind the gatekeeper.
- **Real step-up notification.** Approval is a button on the dashboard, not an
  SMS, push, or webhook round trip. The *policy re-check* at approval time is
  real and tested; the notification channel is a stub, and calling it anything
  else would be a lie.
- **AP2 cryptography.** The mandate is AP2-**shaped** — scoped, expiring,
  tamper-evident — with a SHA-256 integrity hash standing in for signature
  verification. It detects a config file edited after issuance. It does **not**
  prove who issued it: anyone who can write the file can recompute the hash.
  Real AP2 needs signing keys and a verifier, which is a project of its own.
- **Disputes and chargebacks (Track 02).** When an agent is the buyer, "was this
  authorised?" has a genuinely new answer — the audit trail is the evidence. It
  is the obvious next thing to build and it is not built here.
- **Multi-user, auth, or persistence beyond one SQLite file.** One mandate, one
  local database, no login. It is a demonstration of a boundary, not a service.

### Known limits of the boundary itself

- **Split purchases.** Two ₹1,500 buys instead of one ₹3,000 are each legal
  under the per-transaction cap. What catches them is the rolling monthly cap
  and the fact that the pattern is sitting in the log. What is *not* built is
  velocity detection — "three purchases in ninety seconds" is not a rule yet.
  The agent is instructed not to split, and that instruction is a nudge to a
  cooperative model, not a control.
- **A compromised mandate file.** Detected, and fails closed. But an attacker
  with write access to the config also has write access to the hash. The
  integrity check catches accidents and careless edits, not an adversary with
  the filesystem.

---

## Layout

```
src/
  types.ts                  zod schemas + shared event/decision types
  gatekeeper/
    policyEngine.ts         pure function — the whole trust boundary. No I/O.
    mandate.ts              load, expiry, canonical-JSON integrity hash
    service.ts              orchestration: decide → pay → log
  razorpay/client.ts        the ONLY module that imports the Razorpay SDK
  audit/store.ts            append-only SQLite, enforced by triggers
  agent/shoppingAgent.ts    Claude tool-use loop, exactly one tool
  server/index.ts           Express API + static dashboard
dashboard/index.html        the audit view, one file, no framework
scripts/demo-scenarios.ts   the four scenarios
tests/                      68 tests
NOTES.md                    what broke while building this, and how it got fixed
```

The audit trail is append-only in the database, not merely by convention:
`AuditStore` exposes no update or delete method, and `BEFORE UPDATE` /
`BEFORE DELETE` triggers abort the write. Two tests go around the class with raw
SQL to prove it. A resolution is always a new row pointing back at the row it
resolves.
