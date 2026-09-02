/**
 * Types mirror what GET /api/state actually returns. The server is the source
 * of truth; nothing here reshapes or re-derives a policy decision.
 */

export type Decision =
  | 'allowed'
  | 'blocked'
  | 'step_up_required'
  | 'step_up_approved'
  | 'step_up_denied'
  | 'payment_failed';

export interface Violation {
  code: string;
  message: string;
}

export interface EventBudget {
  per_transaction_cap_inr: number;
  monthly_cap_inr: number;
  step_up_threshold_inr: number;
  month_spend_before_inr: number;
  month_spend_after_inr: number;
  monthly_remaining_before_inr: number;
  monthly_remaining_after_inr: number;
}

export interface AuditEvent {
  event_id: string;
  mandate_id: string;
  decision: Decision;
  item: string;
  amount_inr: number;
  category: string;
  merchant: string | null;
  reason: string;
  violations?: Violation[];
  budget?: EventBudget;
  razorpay_order_id?: string | null;
  razorpay_mock?: boolean;
  timestamp: string;
  actor: string;
  retry_of_event_id?: string | null;
  resolves_event_id?: string | null;
}

export interface DashboardState {
  mode: {
    live: boolean;
    label: string;
    agent_available: boolean;
    agent_model: string;
  };
  mandate: {
    mandate_id: string;
    principal: string;
    issued_at: string;
    expires_at: string;
    expired: boolean;
    integrity_hash: string;
    scope: {
      per_transaction_cap_inr: number;
      monthly_cap_inr: number;
      step_up_threshold_inr: number;
      category_allow: string[];
      category_deny: string[];
    };
  };
  budget: {
    month_spend_inr: number;
    monthly_cap_inr: number;
    monthly_remaining_inr: number;
  };
  events: AuditEvent[];
  pending_step_ups: AuditEvent[];
  stats: {
    blocked_count: number;
    blocked_amount_inr: number;
    decisions_logged: number;
  };
}

export const DECISION_LABEL: Record<Decision, string> = {
  allowed: 'paid',
  blocked: 'blocked',
  step_up_required: 'needs approval',
  step_up_approved: 'approved & paid',
  step_up_denied: 'declined by you',
  payment_failed: 'payment failed',
};

/** Which segmented tab a decision belongs under. */
export const DECISION_GROUP: Record<Decision, string> = {
  allowed: 'paid',
  step_up_approved: 'paid',
  blocked: 'blocked',
  step_up_required: 'awaiting',
  step_up_denied: 'other',
  payment_failed: 'other',
};

export async function fetchState(): Promise<DashboardState> {
  const res = await fetch('/api/state', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DashboardState;
}

export async function resolveStepUp(eventId: string, approve: boolean): Promise<void> {
  const res = await fetch(`/api/stepup/${encodeURIComponent(eventId)}/${approve ? 'approve' : 'deny'}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not ${approve ? 'approve' : 'decline'} this (HTTP ${res.status}).`);
  }
}
