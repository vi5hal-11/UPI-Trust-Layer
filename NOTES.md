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
