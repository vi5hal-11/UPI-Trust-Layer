/**
 * The gatekeeper is where a decision turns into money moving or not moving.
 * The two properties that matter most are negative ones: a blocked purchase
 * makes ZERO calls to the payment rail, and an approval that arrives after the
 * budget is gone does not pay. Both are asserted directly against a spy rail.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditStore } from '../src/audit/store.js';
import { computeIntegrityHash } from '../src/gatekeeper/mandate.js';
import { Gatekeeper, GatekeeperError, type PaymentRail } from '../src/gatekeeper/service.js';
import type { Mandate, MandateScope, PurchaseIntent, RazorpayAction } from '../src/types.js';

const SCOPE: MandateScope = {
  per_transaction_cap_inr: 2000,
  monthly_cap_inr: 10_000,
  step_up_threshold_inr: 1500,
  category_allow: ['groceries', 'subscriptions', 'accessories', 'household'],
  category_deny: ['electronics', 'travel', 'gift-cards'],
};

function mandate(): Mandate {
  const principal = 'demo.user@okaxis';
  return {
    mandate_id: 'mandate_test_001',
    principal,
    issued_at: '2026-09-01T00:00:00.000Z',
    expires_at: '2099-12-31T23:59:59+05:30',
    scope: SCOPE,
    integrity_hash: computeIntegrityHash(principal, SCOPE),
  };
}

/** A payment rail that records every call so we can assert on "no calls". */
function spyRail(behaviour?: (intent: PurchaseIntent) => Promise<RazorpayAction>) {
  const calls: PurchaseIntent[] = [];
  const rail: PaymentRail = async (intent) => {
    calls.push(intent);
    if (behaviour) return behaviour(intent);
    return {
      mock: true,
      order_id: `order_TEST_${calls.length}`,
      amount_paise: Math.round(intent.amount_inr * 100),
      currency: 'INR',
      status: 'created',
      receipt: null,
      created_at_unix: 0,
    };
  };
  return { rail, calls };
}

let store: AuditStore;

beforeEach(() => {
  store = new AuditStore(':memory:');
});

function gatekeeper(rail: PaymentRail, now: () => Date = () => new Date()): Gatekeeper {
  return new Gatekeeper({ mandate: mandate(), store, createOrder: rail, now });
}

const buy = (amount_inr: number, category: string, item = 'test item') => ({
  item,
  amount_inr,
  category,
  merchant: 'Test Merchant',
});

describe('attemptPurchase - the allowed path', () => {
  it('pays once and logs the purchase as allowed', async () => {
    const { rail, calls } = spyRail();

    const outcome = await gatekeeper(rail).attemptPurchase(buy(800, 'groceries', 'protein powder'));

    expect(outcome.decision).toBe('allowed');
    expect(outcome.paid).toBe(true);
    expect(calls).toHaveLength(1);
    expect(outcome.event.razorpay_order_id).toBe('order_TEST_1');
    expect(store.monthSpendInr('mandate_test_001', new Date())).toBe(800);
  });
});

describe('attemptPurchase - a block never reaches the payment rail', () => {
  it('makes zero payment calls when the purchase is blocked', async () => {
    const { rail, calls } = spyRail();

    const outcome = await gatekeeper(rail).attemptPurchase(
      buy(15_000, 'electronics', 'gaming keyboard'),
    );

    expect(outcome.decision).toBe('blocked');
    expect(outcome.paid).toBe(false);
    expect(calls).toEqual([]); // the whole thesis of the project
    expect(outcome.event.razorpay_order_id).toBeNull();
  });

  it('logs the block with all three reasons intact', async () => {
    const { rail } = spyRail();

    const outcome = await gatekeeper(rail).attemptPurchase(buy(15_000, 'electronics'));

    expect(outcome.event.violations.map((v) => v.code).sort()).toEqual([
      'CATEGORY_DENIED',
      'MONTHLY_CAP_EXCEEDED',
      'PER_TRANSACTION_CAP_EXCEEDED',
    ]);
  });

  it('never lets a run of blocked attempts eat the monthly budget', async () => {
    const { rail, calls } = spyRail();
    const gate = gatekeeper(rail);

    for (let i = 0; i < 5; i += 1) {
      await gate.attemptPurchase(buy(9000, 'electronics'));
    }

    expect(calls).toEqual([]);
    expect(store.monthSpendInr('mandate_test_001', new Date())).toBe(0);
  });

  it('tells the agent what is left and invites exactly one alternative', async () => {
    const { rail } = spyRail();

    const outcome = await gatekeeper(rail).attemptPurchase(buy(15_000, 'electronics'));

    expect(outcome.agent_message).toContain('₹10,000');
    expect(outcome.agent_message).toMatch(/one alternative/i);
    expect(outcome.agent_message).toMatch(/no payment was attempted/i);
  });
});

describe('attemptPurchase - malformed input', () => {
  it('logs a blocked event instead of crashing', async () => {
    const { rail, calls } = spyRail();

    const outcome = await gatekeeper(rail).attemptPurchase({
      item: '',
      amount_inr: -5,
      category: 'groceries',
    });

    expect(outcome.decision).toBe('blocked');
    expect(outcome.event.violations[0]?.code).toBe('INVALID_INTENT');
    expect(calls).toEqual([]);
  });

  it('survives input that is not an object at all', async () => {
    const { rail } = spyRail();

    const outcome = await gatekeeper(rail).attemptPurchase('please buy me a laptop');

    expect(outcome.decision).toBe('blocked');
    expect(outcome.paid).toBe(false);
  });

  it('does not let a negative amount refund the budget', async () => {
    const { rail } = spyRail();
    const gate = gatekeeper(rail);

    await gate.attemptPurchase(buy(800, 'groceries'));
    await gate.attemptPurchase({ item: 'refund hack', amount_inr: -5000, category: 'groceries' });

    expect(store.monthSpendInr('mandate_test_001', new Date())).toBe(800);
  });
});

describe('attemptPurchase - step-up', () => {
  it('parks the purchase and pays nothing', async () => {
    const { rail, calls } = spyRail();

    const outcome = await gatekeeper(rail).attemptPurchase(buy(1800, 'subscriptions'));

    expect(outcome.decision).toBe('step_up_required');
    expect(outcome.paid).toBe(false);
    expect(calls).toEqual([]);
    expect(store.pendingStepUps('mandate_test_001')).toHaveLength(1);
  });

  it('warns the agent not to split the purchase to duck the threshold', async () => {
    const { rail } = spyRail();

    const outcome = await gatekeeper(rail).attemptPurchase(buy(1800, 'subscriptions'));

    expect(outcome.agent_message).toMatch(/split/i);
    expect(outcome.agent_message).toMatch(/do not/i);
  });
});

describe('resolveStepUp', () => {
  it('pays on approval and logs it as step_up_approved', async () => {
    const { rail, calls } = spyRail();
    const gate = gatekeeper(rail);
    const parked = await gate.attemptPurchase(buy(1800, 'subscriptions'));

    const outcome = await gate.resolveStepUp(parked.event.event_id, true);

    expect(outcome.decision).toBe('step_up_approved');
    expect(outcome.paid).toBe(true);
    expect(calls).toHaveLength(1);
    expect(outcome.event.resolves_event_id).toBe(parked.event.event_id);
    expect(outcome.event.actor).toBe('human');
    expect(store.monthSpendInr('mandate_test_001', new Date())).toBe(1800);
  });

  // CLAUDE.md invariant 2 - the month moves while a request sits parked.
  it('re-runs the policy at approval time and blocks if the cap is now gone', async () => {
    const { rail, calls } = spyRail();
    const gate = gatekeeper(rail);

    const parked = await gate.attemptPurchase(buy(1800, 'subscriptions'));
    // meanwhile the month's budget is spent down to ₹1,600 - less than the
    // ₹1,800 sitting parked, so the approval can no longer be honoured
    for (let i = 0; i < 6; i += 1) {
      await gate.attemptPurchase(buy(1400, 'groceries'));
    }
    expect(store.monthSpendInr('mandate_test_001', new Date())).toBe(8400);
    const callsBeforeApproval = calls.length;

    const outcome = await gate.resolveStepUp(parked.event.event_id, true);

    expect(outcome.decision).toBe('blocked');
    expect(outcome.paid).toBe(false);
    expect(calls).toHaveLength(callsBeforeApproval); // approval bought nothing
    expect(outcome.event.reason).toMatch(/approval/i);
    expect(outcome.event.resolves_event_id).toBe(parked.event.event_id);
  });

  it('logs a denial and pays nothing', async () => {
    const { rail, calls } = spyRail();
    const gate = gatekeeper(rail);
    const parked = await gate.attemptPurchase(buy(1800, 'subscriptions'));

    const outcome = await gate.resolveStepUp(parked.event.event_id, false);

    expect(outcome.decision).toBe('step_up_denied');
    expect(calls).toEqual([]);
    expect(store.pendingStepUps('mandate_test_001')).toEqual([]);
  });

  it('rejects an event id it has never seen', async () => {
    const gate = gatekeeper(spyRail().rail);

    await expect(gate.resolveStepUp('evt_nope', true)).rejects.toThrow(GatekeeperError);
  });

  it('rejects an event that was not parked for approval', async () => {
    const gate = gatekeeper(spyRail().rail);
    const allowed = await gate.attemptPurchase(buy(800, 'groceries'));

    await expect(gate.resolveStepUp(allowed.event.event_id, true)).rejects.toThrow(
      /not waiting for approval/i,
    );
  });

  it('rejects a second resolution of the same step-up', async () => {
    const gate = gatekeeper(spyRail().rail);
    const parked = await gate.attemptPurchase(buy(1800, 'subscriptions'));
    await gate.resolveStepUp(parked.event.event_id, true);

    await expect(gate.resolveStepUp(parked.event.event_id, true)).rejects.toThrow(
      /already been resolved/i,
    );
  });
});

describe('a failure on the payment rail', () => {
  const failing: PaymentRail = async () => {
    throw new Error('Razorpay rejected the order: gateway timeout');
  };

  it('is its own decision and never reads as a purchase', async () => {
    const outcome = await gatekeeper(failing).attemptPurchase(buy(800, 'groceries'));

    expect(outcome.decision).toBe('payment_failed');
    expect(outcome.paid).toBe(false);
    expect(outcome.event.reason).toContain('gateway timeout');
    expect(outcome.agent_message).toMatch(/not.*success|do not report/i);
  });

  // CLAUDE.md invariant 6
  it('does not count against the monthly budget', async () => {
    await gatekeeper(failing).attemptPurchase(buy(800, 'groceries'));

    expect(store.monthSpendInr('mandate_test_001', new Date())).toBe(0);
  });
});

describe('linking a recovery to the block it followed', () => {
  it('auto-links a purchase made shortly after a block', async () => {
    const { rail } = spyRail();
    const gate = gatekeeper(rail);

    const blocked = await gate.attemptPurchase(buy(15_000, 'electronics', 'gaming keyboard'));
    const recovery = await gate.attemptPurchase(buy(1200, 'accessories', 'phone stand'));

    expect(recovery.event.retry_of_event_id).toBe(blocked.event.event_id);
  });

  it('lets an explicit link win over the automatic one', async () => {
    const { rail } = spyRail();
    const gate = gatekeeper(rail);

    const first = await gate.attemptPurchase(buy(15_000, 'electronics'));
    await gate.attemptPurchase(buy(9000, 'travel'));
    const recovery = await gate.attemptPurchase(buy(1200, 'accessories'), {
      retry_of_event_id: first.event.event_id,
    });

    expect(recovery.event.retry_of_event_id).toBe(first.event.event_id);
  });

  it('does not link to a block that is more than ten minutes old', async () => {
    const { rail } = spyRail();
    const realNow = new Date();
    const gate = gatekeeper(rail);
    const blocked = await gate.attemptPurchase(buy(15_000, 'electronics'));

    // the same gatekeeper, eleven minutes later
    const later = new Gatekeeper({
      mandate: mandate(),
      store,
      createOrder: rail,
      now: () => new Date(realNow.getTime() + 11 * 60_000),
    });
    const unrelated = await later.attemptPurchase(buy(1200, 'accessories'));

    expect(blocked.event.retry_of_event_id).toBeNull();
    expect(unrelated.event.retry_of_event_id).toBeNull();
  });

  it('does not link when the previous event was not a block', async () => {
    const { rail } = spyRail();
    const gate = gatekeeper(rail);

    await gate.attemptPurchase(buy(800, 'groceries'));
    const next = await gate.attemptPurchase(buy(900, 'household'));

    expect(next.event.retry_of_event_id).toBeNull();
  });
});
