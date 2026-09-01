/**
 * The policy engine. This is the entire trust boundary.
 *
 * `evaluate` is pure: no database, no network, no clock of its own. Every input
 * arrives as an argument and the same inputs always produce the same output,
 * which is what makes a decision defensible after the fact. Its only imports
 * are the mandate helpers and the shared types.
 *
 * The model may ask for anything. This function decides.
 */
import { isMandateExpired, isMandateTampered } from './mandate.js';
import type {
  Budget,
  Mandate,
  PolicyResult,
  PurchaseIntent,
  Violation,
} from '../types.js';

/**
 * Everything the engine needs to know about the world, passed in so the
 * function stays pure and testable at any point in time.
 */
export interface PolicyContext {
  /** Money that has already MOVED this month. Blocked attempts are not spend. */
  month_spend_so_far_inr: number;
  /** The clock, supplied by the caller. The engine never reads Date.now(). */
  now: Date;
}

/**
 * Fixed rather than machine-local: a pure function's output must not depend on
 * where it runs, and the month boundary that matters for an Indian mandate is
 * the IST one.
 */
const IST = 'Asia/Kolkata';

/** Rupees, grouped Indian-style: ₹15,000 and ₹12,34,567 (lakhs, not millions). */
export function formatInr(amount: number): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** Rupee arithmetic, kept to paise so floats never leak into a reason string. */
function toPaiseRounded(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function formatDay(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 'an unreadable date';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: IST,
  }).format(new Date(parsed));
}

function monthName(now: Date): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: IST }).format(now);
}

function listCategories(categories: readonly string[]): string {
  return categories.join(', ');
}

/**
 * Decide whether a purchase may proceed.
 *
 * Rules are checked in a fixed order and EVERY violation is collected rather
 * than returning on the first one — a blocked purchase should tell the user all
 * of what is wrong, not send them round the loop fixing one thing at a time.
 */
export function evaluate(
  intent: PurchaseIntent,
  mandate: Mandate,
  ctx: PolicyContext,
): PolicyResult {
  const { scope } = mandate;

  const spendBefore = toPaiseRounded(ctx.month_spend_so_far_inr);
  const spendAfter = toPaiseRounded(spendBefore + intent.amount_inr);

  const budget: Budget = {
    per_transaction_cap_inr: scope.per_transaction_cap_inr,
    monthly_cap_inr: scope.monthly_cap_inr,
    step_up_threshold_inr: scope.step_up_threshold_inr,
    month_spend_before_inr: spendBefore,
    month_spend_after_inr: spendAfter,
    monthly_remaining_before_inr: toPaiseRounded(
      Math.max(0, scope.monthly_cap_inr - spendBefore),
    ),
    monthly_remaining_after_inr: toPaiseRounded(
      Math.max(0, scope.monthly_cap_inr - spendAfter),
    ),
  };

  // ---------------------------------------------------------------------
  // Step 1: is the mandate itself trustworthy?
  //
  // This gate comes first and short-circuits deliberately. Every rule below
  // reads its numbers OUT OF the mandate's scope, so if the mandate is expired
  // or has been edited since issuance, those numbers are not evidence of
  // anything. Checking a ₹5,000 purchase against a cap an attacker just raised
  // to ₹9,99,999 is not a safety check, it is theatre — and it would let a
  // forged scope quietly widen what the agent may do.
  //
  // So: an untrustworthy mandate is the whole answer. Fail closed, say so in
  // one clear sentence, and evaluate nothing against numbers we do not trust.
  // ---------------------------------------------------------------------
  const trust: Violation[] = [];

  if (isMandateExpired(mandate, ctx.now)) {
    trust.push({
      code: 'MANDATE_EXPIRED',
      message: `the spending mandate expired on ${formatDay(mandate.expires_at)}`,
    });
  }

  if (isMandateTampered(mandate)) {
    trust.push({
      code: 'MANDATE_TAMPERED',
      message:
        'the spending mandate has been edited since it was issued, so none of its limits can be trusted',
    });
  }

  if (trust.length > 0) {
    return {
      decision: 'blocked',
      reason: `Blocked: ${trust.map((v) => v.message).join('; ')}.`,
      violations: trust,
      budget,
    };
  }

  // ---------------------------------------------------------------------
  // Step 2: the spending rules. Past this point the mandate is trustworthy,
  // so every violation is collected rather than returning on the first.
  // ---------------------------------------------------------------------
  const violations: Violation[] = [];

  // Category. Deny always beats allow — a category on both lists is denied,
  //    and it is reported once, as a denial.
  if (scope.category_deny.includes(intent.category)) {
    violations.push({
      code: 'CATEGORY_DENIED',
      message: `'${intent.category}' is on the blocked list for this mandate`,
    });
  } else if (scope.category_allow.length > 0 && !scope.category_allow.includes(intent.category)) {
    violations.push({
      code: 'CATEGORY_NOT_ALLOWED',
      message:
        `'${intent.category}' is not one of the categories this mandate covers ` +
        `(${listCategories(scope.category_allow)})`,
    });
  }

  // Is this single purchase too big?
  if (intent.amount_inr > scope.per_transaction_cap_inr) {
    violations.push({
      code: 'PER_TRANSACTION_CAP_EXCEEDED',
      message:
        `${formatInr(intent.amount_inr)} is over the ` +
        `${formatInr(scope.per_transaction_cap_inr)} per-transaction cap`,
    });
  }

  // Would the month's total go over? Rolling, so it moves as money is spent.
  if (spendAfter > scope.monthly_cap_inr) {
    violations.push({
      code: 'MONTHLY_CAP_EXCEEDED',
      message:
        `this would take ${monthName(ctx.now)}'s spending to ${formatInr(spendAfter)}, ` +
        `over the ${formatInr(scope.monthly_cap_inr)} monthly cap ` +
        `(${formatInr(budget.monthly_remaining_before_inr)} left)`,
    });
  }

  // A hard violation always beats a step-up. If a purchase is both forbidden
  // and large, it is blocked outright and never parked for approval — parking
  // it would give someone the chance to approve what the mandate forbids.
  if (violations.length > 0) {
    return {
      decision: 'blocked',
      reason: `Blocked: ${violations.map((v) => v.message).join('; ')}.`,
      violations,
      budget,
    };
  }

  if (intent.amount_inr >= scope.step_up_threshold_inr) {
    return {
      decision: 'step_up_required',
      reason:
        `Waiting for your approval: ${formatInr(intent.amount_inr)} for '${intent.item}' is at or ` +
        `above the ${formatInr(scope.step_up_threshold_inr)} approval threshold in this mandate. ` +
        `Nothing has been paid yet.`,
      violations,
      budget,
    };
  }

  return {
    decision: 'allowed',
    reason:
      `Allowed: ${formatInr(intent.amount_inr)} for '${intent.item}' is within the ` +
      `${formatInr(scope.per_transaction_cap_inr)} per-transaction cap, and leaves ` +
      `${formatInr(budget.monthly_remaining_after_inr)} of the ` +
      `${formatInr(scope.monthly_cap_inr)} monthly budget.`,
    violations,
    budget,
  };
}
