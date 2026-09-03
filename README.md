# UPI Agent Trust Layer

[![CI](https://github.com/vi5hal-11/UPI-Trust-Layer/actions/workflows/ci.yml/badge.svg)](https://github.com/vi5hal-11/UPI-Trust-Layer/actions/workflows/ci.yml)

**A deterministic policy gatekeeper between an AI shopping agent and Razorpay.**
Spend caps, category rules and human approval are enforced in code, not in a
prompt, and every decision — allowed or not — is written to an append-only audit
trail.

Built for the Razorpay AI Buildathon, Track 01 (Growth & Agentic Commerce).

```bash
npm install
cp .env.example .env    # add Razorpay TEST keys + an APPROVAL_SECRET
npm run demo            # the four scenarios, against a fresh database
npm start               # landing page at /, audit dashboard at /dashboard
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

**The model is swappable; the boundary is not.** The agent talks to any
OpenAI-compatible endpoint — Groq by default, or OpenAI, Cerebras, a local
Ollama — set with `AGENT_BASE_URL` and `AGENT_MODEL`. That is not a convenience
feature. If swapping a frontier model for a free open-weights one changed which
purchases were allowed, the boundary would be in the prompt, and this project
would be wrong.

---

## What the gatekeeper enforces

Every rule below is a test before it is a feature.

| Rule | Behaviour |
|---|---|
| Per-transaction cap | Over it → blocked. |
| Rolling monthly cap | Counts only money that actually moved. |
| Category deny list | **Deny always beats allow.** |
| Category allow list | Empty list means "anything not denied". |
| Step-up threshold | At or above it, a human must approve. Inclusive. |
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
8. **Test-mode keys only, permanently.** The app refuses to start if
   `RAZORPAY_KEY_ID` is not an `rzp_test_` key, and there is no flag to override
   it. An autonomous agent spending money should not be one environment variable
   away from moving real money.
9. **No stubbed payment path.** Credentials are required; there is no keyless
   mode. Every order in the audit trail is a real Razorpay test-mode order, so a
   reader never has to work out whether an order id is genuine. Tests inject a
   fake rail through the Gatekeeper's `createOrder` option rather than relying
   on production code carrying a mock branch.
10. **A retry cannot pay twice.** `POST /api/intent` honours an
    `Idempotency-Key`; a repeat replays the original decision with no second
    policy evaluation, no second rail call and no second audit event. The same
    key with a *different* body is a `409`, because that is always a caller bug.
11. **Releasing money requires authentication.** Reading the audit trail is
    public — watching the gatekeeper work is the demonstration. Approving or
    declining a purchase, and issuing a mandate, are not.

---

## Running it

Razorpay **test-mode** credentials and an `APPROVAL_SECRET` are required. The
service creates real orders and has no stubbed fallback, so it refuses to start
without them, and it tells you how to get them.

```bash
npm install
cp .env.example .env

npm run demo          # the four scenarios, against a fresh database
npm start             # builds the dashboard, then serves it
npm test              # 78 unit tests
npm run test:e2e      # 21 browser tests (Playwright, chromium)
npm run typecheck     # server, dashboard and e2e as three TS projects
```

**Razorpay keys** — Razorpay Dashboard → switch to **Test Mode** → Account &
Settings → API Keys → Generate. No KYC is needed for test keys. The secret is
shown once.

**`APPROVAL_SECRET`** — unlocks step-up approvals. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

**Putting a real LLM in front of the gatekeeper** is optional. Without a key the
demo runs in *direct mode* — intents go straight to the gatekeeper with no model
in the loop, and every policy decision is identical, which is the point. To see
the agent itself, get a free key at `console.groq.com` (no card), set
`AGENT_API_KEY`, and run `npm run demo:agent`.

Poking at it directly:

```bash
curl -X POST localhost:3000/api/intent -H 'content-type: application/json' \
  -d '{"item":"gaming keyboard","amount_inr":15000,"category":"electronics"}'
```

> `npm run demo` wipes the database, so it cannot run while the server holds it
> open. Stop the server first.

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

## Mandates

A mandate is a row, not a file. It can be issued and revoked while the service
is running, and the gatekeeper resolves the one in force **per decision**, so a
new mandate applies to the very next purchase without a restart.

```bash
GET  /api/mandates              # public
POST /api/mandates              # authenticated — supersedes the current one
POST /api/mandates/:id/revoke   # authenticated — one-way
```

`src/config/policy.default.json` is only a first-run seed. After that the
database is the source of truth.

Mandates are append-only, enforced by triggers. A mandate is never edited:
changing the limits issues a new one and leaves the old row exactly as it was,
because audit events reference the mandate that authorised them and rewriting it
would falsify the record of every decision made under it. Revocation is the only
permitted mutation, and it cannot be undone.

The integrity hash is computed on write and never accepted from the caller —
otherwise anyone who could reach the API could mint a mandate that passes its
own integrity check.

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
  verification. It detects a mandate edited after issuance. It does **not**
  prove who issued it. Real AP2 needs signing keys and a verifier, which is a
  project of its own.
- **Disputes and chargebacks (Track 02).** When an agent is the buyer, "was this
  authorised?" has a genuinely new answer — the audit trail is the evidence. It
  is the obvious next thing to build and it is not built here.
- **Multi-tenancy and user accounts.** There is one holder and one shared
  approval secret, not an identity system. Authentication here answers "may this
  request release money", not "who are you". A real service would need accounts,
  per-tenant isolation and per-tenant credentials — which is a different project,
  and pretending otherwise would be the dishonest kind of scope creep.

### Known limits of the boundary itself

- **Split purchases.** Two ₹1,500 buys instead of one ₹3,000 are each legal
  under the per-transaction cap. What catches them is the rolling monthly cap
  and the fact that the pattern is sitting in the log. What is *not* built is
  velocity detection — "three purchases in ninety seconds" is not a rule yet.
  The agent is instructed not to split, and that instruction is a nudge to a
  cooperative model, not a control.
- **A compromised database.** Tampering is detected and fails closed, and the
  storage layer refuses edits outright. But an attacker who can drop the
  triggers can also recompute a hash. The integrity check catches accidents,
  careless edits and a widened mandate; it does not stop an adversary who owns
  the filesystem.
- **Rate limiting is in-process.** It stops a script hammering the demo, not a
  distributed attacker. Anything stronger belongs at the platform edge.

---

## Layout

```
src/
  types.ts                  zod schemas + shared event/decision types
  gatekeeper/
    policyEngine.ts         pure function — the whole trust boundary. No I/O.
    mandate.ts              expiry, canonical-JSON integrity hash
    service.ts              orchestration: decide → pay → log
  razorpay/client.ts        the ONLY module that imports the Razorpay SDK
  audit/
    store.ts                append-only SQLite, enforced by triggers
    mandateStore.ts         mandates as rows: issue, revoke, never edit
    idempotency.ts          a retried intent replays its original decision
  agent/shoppingAgent.ts    tool-use loop, exactly one tool, any provider
  server/
    index.ts                Express API + the built dashboard
    auth.ts                 HMAC session cookie for the approval gate
    rateLimit.ts            fixed-window limiter, no dependency
dashboard/
  src/Landing.tsx           the story, with the mechanism animated
  src/App.tsx               the audit dashboard
  src/components/           header, cards, event rows, landing pieces
scripts/
  demo-scenarios.ts         the four scenarios
  check-secrets.ts          pre-push credential scan
tests/                      78 unit tests
  e2e/                      21 browser tests
NOTES.md                    what broke while building this, and how it got fixed
```

The audit trail is append-only in the database, not merely by convention:
`AuditStore` exposes no update or delete method, and `BEFORE UPDATE` /
`BEFORE DELETE` triggers abort the write. Tests go around the class with raw SQL
to prove it. A resolution is always a new row pointing back at the row it
resolves.
