/**
 * Orchestration: decide, then pay, then log. Every path through this class ends
 * in exactly one audit event, including the paths where nothing happens.
 *
 * The agent talks to this class and to nothing else. It cannot reach the
 * payment rail, cannot approve its own step-up, and cannot learn anything about
 * the decision except the plain-English message this class hands back.
 */
import { evaluate, formatInr } from './policyEngine.js';
import { PurchaseIntentSchema } from '../types.js';
import type { AuditStore } from '../audit/store.js';
import type {
  Actor,
  AuditEvent,
  Decision,
  Mandate,
  PolicyResult,
  PurchaseIntent,
  RazorpayAction,
  Violation,
} from '../types.js';
import { createOrder as realCreateOrder } from '../razorpay/client.js';

/** The payment rail, injectable so tests can assert that it is never called. */
export type PaymentRail = (intent: PurchaseIntent) => Promise<RazorpayAction>;

export interface GatekeeperOptions {
  mandate: Mandate;
  store: AuditStore;
  /** Defaults to the real Razorpay client. */
  createOrder?: PaymentRail;
  /** Defaults to the system clock. Injectable so time-dependent rules testable. */
  now?: () => Date;
}

export interface AttemptOptions {
  actor?: Actor;
  /** Explicitly mark this attempt as a retry of an earlier blocked event. */
  retry_of_event_id?: string | null;
}

export interface GatekeeperOutcome {
  decision: Decision;
  event: AuditEvent;
  /**
   * Whether money actually moved. The agent is instructed to report success
   * only when this is true, and it is computed here rather than inferred from
   * prose the model might misread.
   */
  paid: boolean;
  order_id: string | null;
  /** Plain English, written to be repeated to a human more or less verbatim. */
  agent_message: string;
}

/** A caller mistake (unknown id, wrong state), not a policy decision. */
export class GatekeeperError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GatekeeperError';
    this.status = status;
  }
}

/** A recovery attempt counts as one if it follows the block this closely. */
const RETRY_LINK_WINDOW_MS = 10 * 60 * 1000;

export class Gatekeeper {
  private readonly mandate: Mandate;
  private readonly store: AuditStore;
  private readonly pay: PaymentRail;
  private readonly now: () => Date;

  constructor(options: GatekeeperOptions) {
    this.mandate = options.mandate;
    this.store = options.store;
    this.pay = options.createOrder ?? realCreateOrder;
    this.now = options.now ?? (() => new Date());
  }

  get mandateInForce(): Mandate {
    return this.mandate;
  }

  monthSpendInr(): number {
    return this.store.monthSpendInr(this.mandate.mandate_id, this.now());
  }

  /**
   * The single door. Everything an agent can ask for arrives here as unknown,
   * unvalidated data.
   */
  async attemptPurchase(
    rawIntent: unknown,
    options: AttemptOptions = {},
  ): Promise<GatekeeperOutcome> {
    const actor: Actor = options.actor ?? 'agent';

    // 1. Validate before anything else. A malformed intent is a logged decision,
    //    never an exception that escapes to the caller. CLAUDE.md invariant 7.
    const parsed = PurchaseIntentSchema.safeParse(rawIntent);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
        .join('; ');
      const violation: Violation = {
        code: 'INVALID_INTENT',
        message: `the purchase request was not valid (${detail})`,
      };
      const event = this.store.append({
        mandate_id: this.mandate.mandate_id,
        decision: 'blocked',
        item: describeUnknownItem(rawIntent),
        amount_inr: 0,
        category: 'unknown',
        merchant: null,
        reason: `Blocked: ${violation.message}.`,
        violations: [violation],
        budget: null,
        razorpay_order_id: null,
        razorpay_mock: false,
        actor,
        retry_of_event_id: options.retry_of_event_id ?? null,
        resolves_event_id: null,
      });
      return {
        decision: 'blocked',
        event,
        paid: false,
        order_id: null,
        agent_message:
          `That request was not a valid purchase, so nothing was attempted: ${detail}. ` +
          `Send item, amount_inr and category correctly and try once more.`,
      };
    }

    const intent = parsed.data;
    const now = this.now();
    const result = evaluate(intent, this.mandate, {
      month_spend_so_far_inr: this.store.monthSpendInr(this.mandate.mandate_id, now),
      now,
    });

    const retryOf = this.resolveRetryLink(options.retry_of_event_id, now);

    // 2. Blocked. Log it, make no payment call at all, and hand back something
    //    the agent can act on rather than a dead end.
    if (result.decision === 'blocked') {
      const event = this.logDecision('blocked', intent, result, {
        actor,
        retry_of_event_id: retryOf,
        resolves_event_id: null,
      });
      return {
        decision: 'blocked',
        event,
        paid: false,
        order_id: null,
        agent_message: this.blockedMessage(result),
      };
    }

    // 3. Parked for a human. Still no payment.
    if (result.decision === 'step_up_required') {
      const event = this.logDecision('step_up_required', intent, result, {
        actor,
        retry_of_event_id: retryOf,
        resolves_event_id: null,
      });
      return {
        decision: 'step_up_required',
        event,
        paid: false,
        order_id: null,
        agent_message:
          `${result.reason} A human has to approve it in the dashboard before anything is ` +
          `paid. Do not try to split this into smaller purchases to get under the ` +
          `${formatInr(result.budget.step_up_threshold_inr)} approval threshold - that is ` +
          `circumvention and it will be blocked. Stop here and tell the user their approval ` +
          `is needed.`,
      };
    }

    // 4. Allowed.
    return this.execute(intent, result, 'allowed', {
      actor,
      retry_of_event_id: retryOf,
      resolves_event_id: null,
    });
  }

  /**
   * A human approves or declines a parked step-up. There is no path here from
   * the agent - the server exposes this only on the dashboard's endpoints.
   */
  async resolveStepUp(eventId: string, approve: boolean): Promise<GatekeeperOutcome> {
    const parked = this.store.get(eventId);
    if (!parked) {
      throw new GatekeeperError(`No decision with id "${eventId}" exists in the audit trail.`, 404);
    }
    if (parked.decision !== 'step_up_required') {
      throw new GatekeeperError(
        `Decision "${eventId}" is not waiting for approval - it was logged as ` +
          `"${parked.decision}".`,
      );
    }
    const stillPending = this.store
      .pendingStepUps(parked.mandate_id)
      .some((event) => event.event_id === eventId);
    if (!stillPending) {
      throw new GatekeeperError(
        `Decision "${eventId}" has already been resolved. The audit trail is append-only, ` +
          `so a second approval would be a second payment.`,
      );
    }

    const intent = intentFromEvent(parked);

    if (!approve) {
      const event = this.store.append({
        mandate_id: this.mandate.mandate_id,
        decision: 'step_up_denied',
        item: intent.item,
        amount_inr: intent.amount_inr,
        category: intent.category,
        merchant: intent.merchant ?? null,
        reason: `Declined by you: ${formatInr(intent.amount_inr)} for '${intent.item}' was not approved. Nothing was paid.`,
        violations: [],
        budget: parked.budget,
        razorpay_order_id: null,
        razorpay_mock: false,
        actor: 'human',
        retry_of_event_id: null,
        resolves_event_id: parked.event_id,
      });
      return {
        decision: 'step_up_denied',
        event,
        paid: false,
        order_id: null,
        agent_message: `The purchase was declined by the account holder. Nothing was paid. Do not retry it.`,
      };
    }

    // CLAUDE.md invariant 2: re-evaluate NOW, not at the time it was parked.
    // The month's spend has moved while this sat waiting, and an approval is
    // permission for this purchase - not permission to exceed the mandate.
    const now = this.now();
    const result = evaluate(intent, this.mandate, {
      month_spend_so_far_inr: this.store.monthSpendInr(this.mandate.mandate_id, now),
      now,
    });

    if (result.decision === 'blocked') {
      const event = this.store.append({
        mandate_id: this.mandate.mandate_id,
        decision: 'blocked',
        item: intent.item,
        amount_inr: intent.amount_inr,
        category: intent.category,
        merchant: intent.merchant ?? null,
        reason:
          `Your approval arrived, but the mandate no longer allows this purchase, so it was ` +
          `not paid. ${result.reason}`,
        violations: result.violations,
        budget: result.budget,
        razorpay_order_id: null,
        razorpay_mock: false,
        actor: 'human',
        retry_of_event_id: null,
        resolves_event_id: parked.event_id,
      });
      return {
        decision: 'blocked',
        event,
        paid: false,
        order_id: null,
        agent_message:
          `The account holder approved this, but by the time the approval arrived the mandate ` +
          `no longer permitted it, so nothing was paid. ${result.reason}`,
      };
    }

    return this.execute(intent, result, 'step_up_approved', {
      actor: 'human',
      retry_of_event_id: null,
      resolves_event_id: parked.event_id,
    });
  }

  /**
   * The only place a payment is attempted, reached only after a decision that
   * permits it. A throw from the rail becomes `payment_failed` - its own
   * decision, which is neither a purchase nor spend.
   */
  private async execute(
    intent: PurchaseIntent,
    result: PolicyResult,
    onSuccess: Extract<Decision, 'allowed' | 'step_up_approved'>,
    links: { actor: Actor; retry_of_event_id: string | null; resolves_event_id: string | null },
  ): Promise<GatekeeperOutcome> {
    let action: RazorpayAction;
    try {
      action = await this.pay(intent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const event = this.store.append({
        mandate_id: this.mandate.mandate_id,
        decision: 'payment_failed',
        item: intent.item,
        amount_inr: intent.amount_inr,
        category: intent.category,
        merchant: intent.merchant ?? null,
        reason:
          `The policy allowed this, but the payment did not go through: ${message}. ` +
          `No money moved, and this does not count against the monthly budget.`,
        violations: [],
        budget: result.budget,
        razorpay_order_id: null,
        razorpay_mock: false,
        ...links,
      });
      return {
        decision: 'payment_failed',
        event,
        paid: false,
        order_id: null,
        agent_message:
          `The policy allowed this purchase but the payment failed on the rail: ${message}. ` +
          `Nothing was paid. Do not report this as a successful purchase.`,
      };
    }

    // The policy result that got us here describes the REQUEST. For an approved
    // step-up that text is "waiting for your approval... nothing has been paid
    // yet", which would be a flat lie on an event where money just moved. The
    // log has to describe what happened, not what was asked for.
    const reason =
      onSuccess === 'step_up_approved'
        ? `Approved by you, re-checked against the mandate, and paid: ` +
          `${formatInr(intent.amount_inr)} for '${intent.item}'. That leaves ` +
          `${formatInr(result.budget.monthly_remaining_after_inr)} of the ` +
          `${formatInr(result.budget.monthly_cap_inr)} monthly budget.`
        : result.reason;

    const event = this.store.append({
      mandate_id: this.mandate.mandate_id,
      decision: onSuccess,
      item: intent.item,
      amount_inr: intent.amount_inr,
      category: intent.category,
      merchant: intent.merchant ?? null,
      reason,
      violations: [],
      budget: result.budget,
      razorpay_order_id: action.order_id,
      razorpay_mock: action.mock,
      ...links,
    });

    return {
      decision: onSuccess,
      event,
      paid: true,
      order_id: action.order_id,
      agent_message:
        `Paid. ${reason} Razorpay order ${action.order_id}` +
        `${action.mock ? ' (mock mode - no keys configured)' : ''}.`,
    };
  }

  private logDecision(
    decision: Decision,
    intent: PurchaseIntent,
    result: PolicyResult,
    links: { actor: Actor; retry_of_event_id: string | null; resolves_event_id: string | null },
  ): AuditEvent {
    return this.store.append({
      mandate_id: this.mandate.mandate_id,
      decision,
      item: intent.item,
      amount_inr: intent.amount_inr,
      category: intent.category,
      merchant: intent.merchant ?? null,
      reason: result.reason,
      violations: result.violations,
      budget: result.budget,
      razorpay_order_id: null,
      razorpay_mock: false,
      ...links,
    });
  }

  private blockedMessage(result: PolicyResult): string {
    const allowed = this.mandate.scope.category_allow;
    const categories = allowed.length > 0 ? allowed.join(', ') : 'any category not on the blocked list';
    return (
      `${result.reason} No payment was attempted. ` +
      `You have ${formatInr(result.budget.monthly_remaining_before_inr)} left of the ` +
      `${formatInr(result.budget.monthly_cap_inr)} monthly budget, and a ` +
      `${formatInr(result.budget.per_transaction_cap_inr)} cap on any single purchase. ` +
      `Allowed categories: ${categories}. If something cheaper in an allowed category meets ` +
      `the same need, propose exactly one alternative and try once more, then stop.`
    );
  }

  /**
   * Link a recovery to the block it followed, so the dashboard can show the
   * pair. An explicit link always wins; otherwise the immediately preceding
   * event counts if it was a block and it was recent.
   */
  private resolveRetryLink(explicit: string | null | undefined, now: Date): string | null {
    if (explicit !== undefined && explicit !== null) return explicit;

    const [previous] = this.store.list(1);
    if (!previous || previous.decision !== 'blocked') return null;

    const age = now.getTime() - Date.parse(previous.timestamp);
    if (Number.isNaN(age) || age < 0 || age > RETRY_LINK_WINDOW_MS) return null;

    return previous.event_id;
  }
}

/** Rebuild the intent from a parked event so approval re-checks the same thing. */
function intentFromEvent(event: AuditEvent): PurchaseIntent {
  return PurchaseIntentSchema.parse({
    item: event.item,
    amount_inr: event.amount_inr,
    category: event.category,
    ...(event.merchant ? { merchant: event.merchant } : {}),
  });
}

/** Best effort label for something that failed validation, for the log. */
function describeUnknownItem(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'item' in raw) {
    const item = (raw as { item?: unknown }).item;
    if (typeof item === 'string' && item.trim()) return item.trim().slice(0, 120);
  }
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 120);
  return '(malformed request)';
}
