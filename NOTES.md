# Build log — what actually broke

Running log kept during the build. The application form asks "what broke, and
how you got out"; this is the raw material for that answer. Entries are written
when the bug is hit, not reconstructed afterwards.

Format: what broke → what I thought was wrong → what was actually wrong → the
fix → the test that stops it recurring.

---

## [Sept 1, 14:43] A tampered mandate was being checked against its own forged caps

**What broke.** Writing the policy engine test-first, one of the 22 failed. The
test edits a valid mandate's `per_transaction_cap_inr` from ₹2,000 up to
₹9,99,999 without re-issuing the integrity hash, then asks for a ₹5,000
purchase. I expected two violations: the tamper, and the ₹5,000 blowing the real
₹2,000 cap. I got one — only `MANDATE_TAMPERED`.

**What I thought was wrong.** That the tamper check was returning early and
skipping the cap checks. I went looking for a `return` in the middle of
`evaluate()`.

**What was actually wrong.** There was no early return. Every rule after the
tamper check reads its numbers straight out of `mandate.scope` — so the
per-transaction check was comparing ₹5,000 against the attacker's ₹9,99,999 and
correctly finding no violation. The engine was computing authorisation from data
it had, one line earlier, declared untrustworthy.

It never let money move, because the tamper itself blocks. But the shape of the
bug is the dangerous one: if the hash check were ever bypassed or a mandate
shipped without a hash, a forged scope would silently widen what the agent may
spend, and the `budget` block returned to the dashboard would display the forged
caps as though they were real.

**The fix.** Mandate trust is now a gate, not a rule. Expired or tampered
short-circuits: block, say exactly that, and evaluate nothing else. You cannot
meaningfully check a request against limits you have just decided are forged.
Collecting every violation still applies to the spending rules below the gate —
the ₹15,000 electronics demo still returns its three reasons.

**The tests that stop it recurring.** Three:
- a tampered mandate whose forged cap would have allowed the purchase is still
  blocked, and the forged figure never appears in the reason a human reads;
- a mandate that is both expired and edited reports both;
- an expired mandate blocks a purchase that breaks three other rules, and
  reports only the expiry — proving the spending rules never ran.

## [Sept 1, 15:22] The audit trail reported a completed payment as "nothing has been paid yet"

**What broke.** Running the four demo scenarios end to end for the first time.
Scenario 4 parks an ₹1,800 subscription for human approval, a person approves
it, and it gets paid — a real Razorpay order id came back. But the event written
to the audit trail read:

```
APPROVED   order_MOCK_e883df662fb7cb (mock)
Waiting for your approval: ₹1,800 ... Nothing has been paid yet.
```

Money moved, an order existed, and the permanent record said nothing had been
paid. In a project whose entire argument is that the log is the product, this is
the worst class of bug there is — worse than crashing, because it is quiet.

**What I thought was wrong.** That `resolveStepUp` was writing the parked event
a second time instead of writing a new one — some copy-paste in the approval
branch. I went looking for a duplicated `append` call.

**What was actually wrong.** The approval path is correct. The bug is one line
in the shared `execute()` helper: it logged `reason: result.reason`, where
`result` is the *policy evaluation of the request*. Re-evaluating an ₹1,800
purchase against a ₹1,500 threshold correctly returns `step_up_required` again —
that is exactly what it should return, since the amount really is above the
threshold. So the reason string attached to a successful payment was the
"waiting for your approval" text, faithfully describing a request rather than
the outcome.

The subtlety is that nothing was broken in the decision logic. The decision was
right, the payment was right, the re-evaluation was right. Only the sentence a
human reads was wrong, which is the part that is never covered by asserting on
`decision === 'step_up_approved'`.

**The fix.** `execute()` now composes the reason from what happened rather than
reusing the request's evaluation: an approved step-up logs "Approved by you,
re-checked against the mandate, and paid: ₹1,800 … That leaves ₹6,200 of the
₹10,000 monthly budget." The agent-facing message is built from the same string,
so the model cannot be handed "nothing has been paid yet" about a purchase that
went through either.

**The test that stops it recurring.** A test that approves a parked step-up and
asserts the logged reason does NOT match /nothing has been paid/i or /waiting
for your approval/i, and DOES say it was approved — asserting on the prose, not
just the decision enum, because the prose was the only thing wrong.
