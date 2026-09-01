/**
 * The audit store is where CLAUDE.md invariants 5 and 6 live: only money that
 * actually moved counts as spend, and a failed payment is not a purchase.
 * Getting this wrong is silent - the caps quietly drift - so it is tested
 * directly rather than through the service.
 */
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditStore } from '../src/audit/store.js';
import type { AuditEventInput, Decision } from '../src/types.js';

const MANDATE = 'mandate_test_001';
const NOW = new Date('2026-09-15T10:00:00.000Z');

function store(): AuditStore {
  return new AuditStore(':memory:');
}

function tempDbPath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'uatl-audit-'));
  return {
    path: join(dir, 'audit.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function event(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    mandate_id: MANDATE,
    decision: 'allowed',
    item: 'protein powder',
    amount_inr: 800,
    category: 'groceries',
    merchant: 'BigBasket',
    reason: 'Allowed: within every limit.',
    violations: [],
    budget: null,
    razorpay_order_id: 'order_MOCK_abc',
    razorpay_mock: true,
    actor: 'agent',
    retry_of_event_id: null,
    resolves_event_id: null,
    ...overrides,
  };
}

describe('AuditStore - appending and reading', () => {
  it('stamps an event id and a timestamp on append', () => {
    const db = store();

    const appended = db.append(event());

    expect(appended.event_id).toMatch(/^evt_[0-9a-f]+$/);
    expect(Number.isNaN(Date.parse(appended.timestamp))).toBe(false);
    expect(appended.item).toBe('protein powder');
  });

  it('returns events newest first, even when written in the same millisecond', () => {
    const db = store();

    const first = db.append(event({ item: 'first' }));
    const second = db.append(event({ item: 'second' }));
    const third = db.append(event({ item: 'third' }));

    expect(db.list(10).map((e) => e.event_id)).toEqual([
      third.event_id,
      second.event_id,
      first.event_id,
    ]);
  });

  it('honours the list limit', () => {
    const db = store();
    for (let i = 0; i < 5; i += 1) db.append(event());

    expect(db.list(2)).toHaveLength(2);
  });

  it('round-trips violations and the budget block through JSON', () => {
    const db = store();

    const appended = db.append(
      event({
        decision: 'blocked',
        violations: [{ code: 'CATEGORY_DENIED', message: "'electronics' is blocked" }],
        budget: {
          per_transaction_cap_inr: 2000,
          monthly_cap_inr: 10_000,
          step_up_threshold_inr: 1500,
          month_spend_before_inr: 0,
          month_spend_after_inr: 15_000,
          monthly_remaining_before_inr: 10_000,
          monthly_remaining_after_inr: 0,
        },
      }),
    );

    const read = db.get(appended.event_id);

    expect(read?.violations).toEqual([
      { code: 'CATEGORY_DENIED', message: "'electronics' is blocked" },
    ]);
    expect(read?.budget?.monthly_cap_inr).toBe(10_000);
  });

  it('returns null for an event id it has never seen', () => {
    expect(store().get('evt_nope')).toBeNull();
  });
});

describe('AuditStore - what counts as spend', () => {
  // CLAUDE.md invariant 5
  it('counts allowed and step_up_approved', () => {
    const db = store();
    db.append(event({ decision: 'allowed', amount_inr: 800 }));
    db.append(event({ decision: 'step_up_approved', amount_inr: 1800 }));

    expect(db.monthSpendInr(MANDATE, NOW)).toBe(2600);
  });

  // CLAUDE.md invariants 5 and 6 - the expensive bug. A run of denied attempts
  // must not quietly exhaust the month's budget.
  it('ignores every decision where no money moved', () => {
    const db = store();
    const nonSpending: Decision[] = [
      'blocked',
      'step_up_required',
      'step_up_denied',
      'payment_failed',
    ];
    for (const decision of nonSpending) {
      db.append(event({ decision, amount_inr: 15_000 }));
    }

    expect(db.monthSpendInr(MANDATE, NOW)).toBe(0);
  });

  it('leaves the budget untouched after five blocked attempts', () => {
    const db = store();
    for (let i = 0; i < 5; i += 1) {
      db.append(event({ decision: 'blocked', amount_inr: 15_000 }));
    }

    expect(db.monthSpendInr(MANDATE, NOW)).toBe(0);
  });

  it('does not count spend from a different mandate', () => {
    const db = store();
    db.append(event({ amount_inr: 800 }));
    db.append(event({ mandate_id: 'mandate_someone_else', amount_inr: 5000 }));

    expect(db.monthSpendInr(MANDATE, NOW)).toBe(800);
  });

  it('does not count spend from a different month', () => {
    const db = store();
    db.append(event({ amount_inr: 800 }));

    expect(db.monthSpendInr(MANDATE, new Date('2026-10-02T10:00:00.000Z'))).toBe(0);
  });

  it('returns zero for a mandate that has never spent anything', () => {
    expect(store().monthSpendInr(MANDATE, NOW)).toBe(0);
  });
});

describe('AuditStore - pending step-ups', () => {
  it('lists a parked step-up that nothing has resolved', () => {
    const db = store();
    const parked = db.append(event({ decision: 'step_up_required', amount_inr: 1800 }));

    expect(db.pendingStepUps(MANDATE).map((e) => e.event_id)).toEqual([parked.event_id]);
  });

  it('drops a step-up once a later event resolves it', () => {
    const db = store();
    const parked = db.append(event({ decision: 'step_up_required', amount_inr: 1800 }));
    db.append(
      event({
        decision: 'step_up_approved',
        amount_inr: 1800,
        actor: 'human',
        resolves_event_id: parked.event_id,
      }),
    );

    expect(db.pendingStepUps(MANDATE)).toEqual([]);
  });

  it('drops a step-up that was denied', () => {
    const db = store();
    const parked = db.append(event({ decision: 'step_up_required', amount_inr: 1800 }));
    db.append(
      event({
        decision: 'step_up_denied',
        amount_inr: 1800,
        actor: 'human',
        resolves_event_id: parked.event_id,
      }),
    );

    expect(db.pendingStepUps(MANDATE)).toEqual([]);
  });

  it("does not leak another mandate's pending step-ups", () => {
    const db = store();
    db.append(event({ mandate_id: 'mandate_someone_else', decision: 'step_up_required' }));

    expect(db.pendingStepUps(MANDATE)).toEqual([]);
  });
});

describe('AuditStore - append only', () => {
  it('exposes no method that could update or delete an event', () => {
    const db = store();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(db));

    expect(surface).not.toContain('update');
    expect(surface).not.toContain('delete');
    expect(surface.filter((name) => /update|delete|remove|edit/i.test(name))).toEqual([]);
  });

  // Convention is not enough when the claim is "append-only audit trail". These
  // two go around the AuditStore API entirely and hit the file with raw SQL, the
  // way a careless future query or a curious judge would.
  it('refuses an UPDATE even from a raw connection to the file', () => {
    const { path, cleanup } = tempDbPath();
    try {
      const db = new AuditStore(path);
      const appended = db.append(event());
      db.close();

      const raw = new Database(path);
      expect(() =>
        raw
          .prepare('UPDATE audit_events SET amount_inr = 1 WHERE event_id = ?')
          .run(appended.event_id),
      ).toThrow(/append-only/i);
      raw.close();
    } finally {
      cleanup();
    }
  });

  it('refuses a DELETE even from a raw connection to the file', () => {
    const { path, cleanup } = tempDbPath();
    try {
      const db = new AuditStore(path);
      db.append(event());
      db.close();

      const raw = new Database(path);
      expect(() => raw.prepare('DELETE FROM audit_events').run()).toThrow(/append-only/i);
      raw.close();
    } finally {
      cleanup();
    }
  });
});
