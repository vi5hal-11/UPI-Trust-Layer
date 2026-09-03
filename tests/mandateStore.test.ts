/**
 * Mandates moved from a JSON file into the database, which means the limits on
 * an agent's spending are now editable at runtime. That makes the storage
 * layer part of the trust boundary, so it gets the same adversarial treatment
 * as the policy engine.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { MandateStore } from '../src/audit/mandateStore.js';
import { isMandateTampered } from '../src/gatekeeper/mandate.js';
import type { MandateScope } from '../src/types.js';

const SCOPE: MandateScope = {
  per_transaction_cap_inr: 2000,
  monthly_cap_inr: 10000,
  step_up_threshold_inr: 1500,
  category_allow: ['groceries'],
  category_deny: ['electronics'],
};

const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

describe('MandateStore', () => {
  let db: Database.Database;
  let store: MandateStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new MandateStore(db);
  });

  it('has no mandate in force until one is issued', () => {
    expect(store.active()).toBeNull();
    expect(store.count()).toBe(0);
  });

  it('stamps an integrity hash the mandate module accepts', () => {
    const mandate = store.issue({ principal: 'a@okaxis', scope: SCOPE, expires_at: NEXT_YEAR });
    expect(mandate.integrity_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(isMandateTampered(mandate)).toBe(false);
  });

  it('computes the hash itself rather than trusting the caller', () => {
    // A caller-supplied hash would let anyone who can reach the API mint a
    // mandate that passes its own integrity check.
    const mandate = store.issue({
      principal: 'a@okaxis',
      scope: { ...SCOPE, per_transaction_cap_inr: 999_999 },
      expires_at: NEXT_YEAR,
    });
    expect(isMandateTampered(mandate)).toBe(false);
  });

  it('detects a widened mandate even if the storage guard is defeated', () => {
    const mandate = store.issue({ principal: 'a@okaxis', scope: SCOPE, expires_at: NEXT_YEAR });

    // The trigger stops an UPDATE through this connection, so to test the
    // SECOND line of defence we have to remove the first - which is exactly
    // what an attacker with the database file would do. The integrity hash has
    // to survive that, or it is decoration.
    db.exec('DROP TRIGGER mandates_append_only');
    db.prepare(`UPDATE mandates SET scope_json = ? WHERE mandate_id = ?`).run(
      JSON.stringify({ ...SCOPE, monthly_cap_inr: 5_000_000 }),
      mandate.mandate_id,
    );

    const reread = store.active();
    expect(reread).not.toBeNull();
    expect(isMandateTampered(reread!)).toBe(true);
    // And the forged figure must never be presented as authoritative.
    expect(reread!.scope.monthly_cap_inr).toBe(5_000_000);
    expect(isMandateTampered(reread!)).toBe(true);
  });

  it('supersedes rather than edits: the newest unrevoked mandate is in force', () => {
    const first = store.issue({ principal: 'a@okaxis', scope: SCOPE, expires_at: NEXT_YEAR });
    const second = store.issue({
      principal: 'a@okaxis',
      scope: { ...SCOPE, monthly_cap_inr: 25000 },
      expires_at: NEXT_YEAR,
    });

    expect(store.active()?.mandate_id).toBe(second.mandate_id);
    // The superseded one is still there: audit events reference it.
    expect(store.list().map((m) => m.mandate_id)).toContain(first.mandate_id);
    expect(store.count()).toBe(2);
  });

  it('refuses to let a mandate be edited in place', () => {
    const mandate = store.issue({ principal: 'a@okaxis', scope: SCOPE, expires_at: NEXT_YEAR });

    // Rewriting a mandate would falsify the record of every decision made
    // under it, so the database itself refuses.
    expect(() =>
      db
        .prepare(`UPDATE mandates SET principal = ? WHERE mandate_id = ?`)
        .run('attacker@okaxis', mandate.mandate_id),
    ).toThrow(/append-only/i);

    expect(() =>
      db.prepare(`DELETE FROM mandates WHERE mandate_id = ?`).run(mandate.mandate_id),
    ).toThrow(/cannot be deleted/i);
  });

  it('revokes one-way, and revocation cannot be undone', () => {
    const mandate = store.issue({ principal: 'a@okaxis', scope: SCOPE, expires_at: NEXT_YEAR });

    expect(store.revoke(mandate.mandate_id)).toBe(true);
    expect(store.active()).toBeNull();

    // Revoking again is a no-op, not an error.
    expect(store.revoke(mandate.mandate_id)).toBe(false);

    // And un-revoking is refused at the storage layer: the trigger fires on any
    // update to an already-revoked row.
    expect(() =>
      db
        .prepare(`UPDATE mandates SET revoked_at = NULL WHERE mandate_id = ?`)
        .run(mandate.mandate_id),
    ).toThrow(/append-only/i);
  });

  it('falls back to the previous mandate when the newest is revoked', () => {
    const first = store.issue({ principal: 'a@okaxis', scope: SCOPE, expires_at: NEXT_YEAR });
    const second = store.issue({ principal: 'a@okaxis', scope: SCOPE, expires_at: NEXT_YEAR });

    store.revoke(second.mandate_id);
    expect(store.active()?.mandate_id).toBe(first.mandate_id);
  });

  it('seeds only once, and never a second time', () => {
    const seed = {
      mandate_id: 'mandate_seed',
      principal: 'seed@okaxis',
      issued_at: new Date().toISOString(),
      expires_at: NEXT_YEAR,
      scope: SCOPE,
      integrity_hash: undefined,
    };

    const a = store.seedIfEmpty(seed as never);
    const b = store.seedIfEmpty(seed as never);

    expect(a.mandate_id).toBe(b.mandate_id);
    expect(store.count()).toBe(1);
  });

  it('refuses to use a row that is no longer a valid mandate', () => {
    const mandate = store.issue({ principal: 'a@okaxis', scope: SCOPE, expires_at: NEXT_YEAR });

    // A negative cap is not a mandate. Reading it must fail loudly rather than
    // hand the policy engine nonsense to authorise spending against.
    // Again: drop the storage guard first, since it would otherwise (correctly)
    // refuse the corruption we are trying to simulate.
    db.exec('DROP TRIGGER mandates_append_only');
    db.prepare(`UPDATE mandates SET scope_json = ? WHERE mandate_id = ?`).run(
      JSON.stringify({ ...SCOPE, per_transaction_cap_inr: -1 }),
      mandate.mandate_id,
    );

    expect(() => store.active()).toThrow(/not a valid mandate/i);
  });
});
