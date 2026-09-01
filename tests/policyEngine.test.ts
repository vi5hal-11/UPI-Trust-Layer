/**
 * The policy engine is the entire trust boundary, so it is the most-tested file
 * in the repo. Every invariant in CLAUDE.md has at least one test here, and the
 * adversarial cases (tampered mandate, hard-rule-beats-step-up, deny-beats-
 * allow) matter more than the happy path.
 */
import { describe, expect, it } from 'vitest';
import { evaluate, formatInr } from '../src/gatekeeper/policyEngine.js';
import { computeIntegrityHash } from '../src/gatekeeper/mandate.js';
import {
  PurchaseIntentSchema,
  type Mandate,
  type MandateScope,
  type PurchaseIntent,
} from '../src/types.js';

const BASE_SCOPE: MandateScope = {
  per_transaction_cap_inr: 2000,
  monthly_cap_inr: 10_000,
  step_up_threshold_inr: 1500,
  category_allow: ['groceries', 'subscriptions', 'accessories', 'household'],
  category_deny: ['electronics', 'travel', 'gift-cards'],
};

/** A mandate that is internally consistent: its hash matches its own scope. */
function makeMandate(
  scope: MandateScope = BASE_SCOPE,
  expires = '2026-12-31T23:59:59.000Z',
): Mandate {
  const principal = 'demo.user@okaxis';
  return {
    mandate_id: 'mandate_test_001',
    principal,
    issued_at: '2026-09-01T00:00:00.000Z',
    expires_at: expires,
    scope,
    integrity_hash: computeIntegrityHash(principal, scope),
  };
}

function intent(amount_inr: number, category: string, item = 'test item'): PurchaseIntent {
  return PurchaseIntentSchema.parse({ item, amount_inr, category, merchant: 'Test Merchant' });
}

/** Mid-month, comfortably inside the mandate's validity window. */
const NOW = new Date('2026-09-15T10:00:00.000Z');
const ctx = (month_spend_so_far_inr = 0, now: Date = NOW) => ({ month_spend_so_far_inr, now });

const codes = (result: { violations: { code: string }[] }) =>
  result.violations.map((v) => v.code).sort();

describe('evaluate - the allowed path', () => {
  it('allows a purchase that is inside every limit', () => {
    const result = evaluate(intent(800, 'groceries', 'protein powder'), makeMandate(), ctx(0));

    expect(result.decision).toBe('allowed');
    expect(result.violations).toEqual([]);
    expect(result.reason).toContain('₹800');
  });

  it('allows spending that lands exactly on the monthly cap', () => {
    const result = evaluate(intent(800, 'groceries'), makeMandate(), ctx(9200));

    expect(result.decision).toBe('allowed');
    expect(result.budget.month_spend_after_inr).toBe(10_000);
    expect(result.budget.monthly_remaining_after_inr).toBe(0);
  });

  it('treats an empty allow list as anything that is not denied', () => {
    const openScope: MandateScope = { ...BASE_SCOPE, category_allow: [] };

    const result = evaluate(intent(500, 'stationery'), makeMandate(openScope), ctx(0));

    expect(result.decision).toBe('allowed');
  });
});

describe('evaluate - hard rules', () => {
  it('blocks a purchase over the per-transaction cap', () => {
    const result = evaluate(intent(2500, 'groceries'), makeMandate(), ctx(0));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toContain('PER_TRANSACTION_CAP_EXCEEDED');
  });

  it('blocks a category on the deny list', () => {
    const result = evaluate(intent(500, 'electronics'), makeMandate(), ctx(0));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['CATEGORY_DENIED']);
  });

  it('blocks a category that is missing from a non-empty allow list', () => {
    const result = evaluate(intent(500, 'jewellery'), makeMandate(), ctx(0));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['CATEGORY_NOT_ALLOWED']);
  });

  it('blocks when the rolling monthly cap would break', () => {
    const result = evaluate(intent(800, 'groceries'), makeMandate(), ctx(9500));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['MONTHLY_CAP_EXCEEDED']);
    expect(result.budget.month_spend_after_inr).toBe(10_300);
  });

  it('blocks one rupee over the monthly cap', () => {
    const result = evaluate(intent(801, 'groceries'), makeMandate(), ctx(9200));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['MONTHLY_CAP_EXCEEDED']);
  });

  // CLAUDE.md invariant 4
  it('lets the deny list beat the allow list when a category is on both', () => {
    const contradictory: MandateScope = {
      ...BASE_SCOPE,
      category_allow: ['groceries', 'electronics'],
      category_deny: ['electronics'],
    };

    const result = evaluate(intent(500, 'electronics'), makeMandate(contradictory), ctx(0));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['CATEGORY_DENIED']);
  });
});

describe('evaluate - mandate integrity', () => {
  it('blocks against an expired mandate', () => {
    const result = evaluate(
      intent(500, 'groceries'),
      makeMandate(),
      ctx(0, new Date('2027-01-05T00:00:00.000Z')),
    );

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toContain('MANDATE_EXPIRED');
  });

  it('blocks against a mandate whose scope was edited after issuance', () => {
    const valid = makeMandate();
    // An attacker raises the cap in the config file but cannot re-issue the hash.
    const edited: Mandate = {
      ...valid,
      scope: { ...valid.scope, per_transaction_cap_inr: 999_999 },
    };

    // ₹5,000 sails through the forged ₹9,99,999 cap, so if the engine trusted
    // the edited scope this would come back allowed.
    const result = evaluate(intent(5000, 'groceries'), edited, ctx(0));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['MANDATE_TAMPERED']);
    // the forged number must never reach a decision or a reason a human reads
    expect(result.reason).not.toContain('9,99,999');
  });

  it('reports both problems when a mandate is expired and edited', () => {
    const valid = makeMandate(BASE_SCOPE, '2026-01-01T00:00:00.000Z');
    const edited: Mandate = {
      ...valid,
      scope: { ...valid.scope, monthly_cap_inr: 500_000 },
    };

    const result = evaluate(intent(500, 'groceries'), edited, ctx(0));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['MANDATE_EXPIRED', 'MANDATE_TAMPERED']);
  });

  it('does not evaluate spending rules against an untrustworthy mandate', () => {
    // Denied category AND over every cap - but the mandate is expired, so the
    // only honest answer is that there is no valid permission to check against.
    const result = evaluate(
      intent(15_000, 'electronics'),
      makeMandate(),
      ctx(0, new Date('2027-01-05T00:00:00.000Z')),
    );

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['MANDATE_EXPIRED']);
  });
});

describe('evaluate - step-up', () => {
  it('requires step-up exactly at the threshold', () => {
    const result = evaluate(intent(1500, 'subscriptions'), makeMandate(), ctx(0));

    expect(result.decision).toBe('step_up_required');
    expect(result.violations).toEqual([]);
  });

  it('does not require step-up one rupee below the threshold', () => {
    const result = evaluate(intent(1499, 'subscriptions'), makeMandate(), ctx(0));

    expect(result.decision).toBe('allowed');
  });

  // CLAUDE.md invariant 1 - otherwise a human can be socially engineered into
  // approving something the mandate forbids outright.
  it('blocks rather than parks when a hard rule is broken above the threshold', () => {
    const result = evaluate(intent(1800, 'electronics'), makeMandate(), ctx(0));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['CATEGORY_DENIED']);
  });

  it('blocks rather than parks when the monthly cap would break above the threshold', () => {
    const result = evaluate(intent(1600, 'groceries'), makeMandate(), ctx(9000));

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual(['MONTHLY_CAP_EXCEEDED']);
  });
});

describe('evaluate - reporting', () => {
  // CLAUDE.md invariant 3 - the blocked demo shows three reasons at once.
  it('collects every violation instead of returning on the first', () => {
    const result = evaluate(
      intent(15_000, 'electronics', 'gaming keyboard'),
      makeMandate(),
      ctx(0),
    );

    expect(result.decision).toBe('blocked');
    expect(codes(result)).toEqual([
      'CATEGORY_DENIED',
      'MONTHLY_CAP_EXCEEDED',
      'PER_TRANSACTION_CAP_EXCEEDED',
    ]);
  });

  it('writes the reason in plain English with Indian rupee grouping', () => {
    const result = evaluate(
      intent(15_000, 'electronics', 'gaming keyboard'),
      makeMandate(),
      ctx(0),
    );

    expect(result.reason).toContain('₹15,000');
    expect(result.reason).toContain('₹2,000');
    expect(result.reason).toContain('electronics');
    // no machine-readable codes leaking into prose a judge reads
    expect(result.reason).not.toMatch(/[A-Z]{2,}_[A-Z]/);
  });

  it('returns a budget block on every decision', () => {
    const results = [
      evaluate(intent(800, 'groceries'), makeMandate(), ctx(0)), // allowed
      evaluate(intent(15_000, 'electronics'), makeMandate(), ctx(0)), // blocked
      evaluate(intent(1500, 'subscriptions'), makeMandate(), ctx(0)), // step-up
    ];

    for (const result of results) {
      expect(result.budget).toMatchObject({
        per_transaction_cap_inr: 2000,
        monthly_cap_inr: 10_000,
        step_up_threshold_inr: 1500,
        month_spend_before_inr: 0,
      });
      expect(result.budget.monthly_remaining_before_inr).toBe(10_000);
    }
  });

  it('formats rupees Indian-style', () => {
    expect(formatInr(800)).toBe('₹800');
    expect(formatInr(15_000)).toBe('₹15,000');
    expect(formatInr(1_234_567)).toBe('₹12,34,567'); // lakh grouping, not thousands
    expect(formatInr(800.5)).toBe('₹800.50');
  });
});

describe('evaluate - determinism', () => {
  it('returns identical output for identical input', () => {
    const a = evaluate(intent(15_000, 'electronics'), makeMandate(), ctx(2500));
    const b = evaluate(intent(15_000, 'electronics'), makeMandate(), ctx(2500));

    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('takes its clock from ctx.now and never from the system clock', () => {
    const mandate = makeMandate();
    const before = evaluate(
      intent(500, 'groceries'),
      mandate,
      ctx(0, new Date('2026-09-15T00:00:00.000Z')),
    );
    const after = evaluate(
      intent(500, 'groceries'),
      mandate,
      ctx(0, new Date('2027-06-01T00:00:00.000Z')),
    );

    expect(before.decision).toBe('allowed');
    expect(after.decision).toBe('blocked');
  });

  it('does not mutate the intent, the mandate or the context it is given', () => {
    const mandate = makeMandate();
    const purchase = intent(15_000, 'electronics');
    const context = ctx(2500);
    const snapshot = JSON.stringify({ mandate, purchase, context });

    evaluate(purchase, mandate, context);

    expect(JSON.stringify({ mandate, purchase, context })).toBe(snapshot);
  });
});
