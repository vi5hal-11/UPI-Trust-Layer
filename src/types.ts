/**
 * Shared types and the validation boundary.
 *
 * Everything an agent produces is parsed through a zod schema here before it is
 * allowed anywhere near the policy engine or the payment rail. See CLAUDE.md,
 * invariant 7.
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Purchase intent — the only thing an agent can ask for                       */
/* -------------------------------------------------------------------------- */

export const PurchaseIntentSchema = z.object({
  item: z
    .string({ required_error: 'item is required' })
    .trim()
    .min(1, 'item cannot be empty'),
  amount_inr: z
    .number({ required_error: 'amount_inr is required', invalid_type_error: 'amount_inr must be a number' })
    .finite('amount_inr must be a finite number')
    .positive('amount_inr must be greater than zero'),
  category: z
    .string({ required_error: 'category is required' })
    .trim()
    .min(1, 'category cannot be empty')
    .transform((s) => s.toLowerCase()),
  merchant: z.string().trim().min(1).optional(),
});

export type PurchaseIntent = z.infer<typeof PurchaseIntentSchema>;

/* -------------------------------------------------------------------------- */
/* Mandate — AP2-shaped: scoped, expiring, tamper-evident                      */
/* -------------------------------------------------------------------------- */

const isoDate = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .refine((s) => !Number.isNaN(Date.parse(s)), `${label} must be an ISO-8601 date`);

const categoryList = z
  .array(z.string())
  .default([])
  .transform((list) => list.map((c) => c.trim().toLowerCase()));

export const MandateScopeSchema = z.object({
  per_transaction_cap_inr: z.number().finite().positive(),
  monthly_cap_inr: z.number().finite().positive(),
  category_allow: categoryList,
  category_deny: categoryList,
  step_up_threshold_inr: z.number().finite().positive(),
});

export type MandateScope = z.infer<typeof MandateScopeSchema>;

export const MandateSchema = z.object({
  mandate_id: z.string().trim().min(1),
  principal: z.string().trim().min(1),
  issued_at: isoDate('issued_at'),
  expires_at: isoDate('expires_at'),
  scope: MandateScopeSchema,
  /**
   * SHA-256 over the canonical JSON of { principal, scope }. Deliberately NOT a
   * signature — see the README's "deliberately not built" section. It detects
   * an edited config file; it does not prove who issued it.
   */
  integrity_hash: z.string().trim().min(1).optional(),
});

export type Mandate = z.infer<typeof MandateSchema>;

/* -------------------------------------------------------------------------- */
/* Decisions                                                                   */
/* -------------------------------------------------------------------------- */

export const DECISIONS = [
  'allowed',
  'blocked',
  'step_up_required',
  'step_up_approved',
  'step_up_denied',
  'payment_failed',
] as const;

export type Decision = (typeof DECISIONS)[number];

/** The three outcomes the pure policy engine can reach. */
export type PolicyDecision = Extract<Decision, 'allowed' | 'blocked' | 'step_up_required'>;

/** Decisions that mean money actually moved. CLAUDE.md invariant 5. */
export const SPENDING_DECISIONS: readonly Decision[] = ['allowed', 'step_up_approved'];

export const VIOLATION_CODES = [
  'INVALID_INTENT',
  'MANDATE_EXPIRED',
  'MANDATE_TAMPERED',
  'CATEGORY_DENIED',
  'CATEGORY_NOT_ALLOWED',
  'PER_TRANSACTION_CAP_EXCEEDED',
  'MONTHLY_CAP_EXCEEDED',
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

export interface Violation {
  /** Machine-readable, for the dashboard to style. */
  code: ViolationCode;
  /** One clause of plain English, for a human to read. */
  message: string;
}

/** The money picture at the moment of the decision. Present on every result. */
export interface Budget {
  per_transaction_cap_inr: number;
  monthly_cap_inr: number;
  step_up_threshold_inr: number;
  month_spend_before_inr: number;
  /** What the month's spend WOULD be if this purchase went through. */
  month_spend_after_inr: number;
  monthly_remaining_before_inr: number;
  monthly_remaining_after_inr: number;
}

export interface PolicyResult {
  decision: PolicyDecision;
  /** Written for a non-technical reader, rupees grouped Indian-style. */
  reason: string;
  violations: Violation[];
  budget: Budget;
}

/* -------------------------------------------------------------------------- */
/* Payment rail                                                                */
/* -------------------------------------------------------------------------- */

export interface RazorpayAction {
  /** true when no keys are configured and the order object is a stub. */
  mock: boolean;
  order_id: string;
  amount_paise: number;
  currency: string;
  status: string;
  receipt: string | null;
  created_at_unix: number;
}

/* -------------------------------------------------------------------------- */
/* Audit trail — append only                                                   */
/* -------------------------------------------------------------------------- */

export type Actor = 'agent' | 'human' | 'system';

export interface AuditEvent {
  event_id: string;
  /** ISO-8601, UTC. */
  timestamp: string;
  mandate_id: string;
  decision: Decision;
  item: string;
  amount_inr: number;
  category: string;
  merchant: string | null;
  reason: string;
  violations: Violation[];
  budget: Budget | null;
  razorpay_order_id: string | null;
  razorpay_mock: boolean;
  actor: Actor;
  /** This attempt is a second try after `retry_of_event_id` was blocked. */
  retry_of_event_id: string | null;
  /** This event closes out `resolves_event_id` (a parked step-up). */
  resolves_event_id: string | null;
}

/** What a caller supplies; the store stamps event_id and timestamp. */
export type AuditEventInput = Omit<AuditEvent, 'event_id' | 'timestamp'>;
