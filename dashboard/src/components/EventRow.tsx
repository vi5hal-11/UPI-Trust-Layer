import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { motionTokens, springs } from '@/lib/motion';
import { cn, inr, shortDate } from '@/lib/utils';
import { DECISION_LABEL, type AuditEvent, type Decision } from '@/lib/api';

const TONE: Record<Decision, { edge: string; pill: string; rail: string }> = {
  allowed: { edge: 'bg-ok', pill: 'border-ok-line bg-ok-soft text-ok', rail: 'text-ok' },
  step_up_approved: { edge: 'bg-ok', pill: 'border-ok-line bg-ok-soft text-ok', rail: 'text-ok' },
  blocked: { edge: 'bg-stop', pill: 'border-stop-line bg-stop-soft text-stop', rail: 'text-stop' },
  step_up_required: {
    edge: 'bg-wait',
    pill: 'border-wait-line bg-wait-soft text-wait',
    rail: 'text-wait',
  },
  step_up_denied: {
    edge: 'bg-mute',
    pill: 'border-mute-line bg-mute-soft text-mute',
    rail: 'text-mute',
  },
  payment_failed: {
    edge: 'bg-fail',
    pill: 'border-fail-line bg-fail-soft text-fail',
    rail: 'text-fail',
  },
};

/**
 * agent -> gatekeeper -> rail. The first two nodes are always reached, so they
 * stay neutral; only the third carries the row's status colour. A blocked
 * purchase visibly stops at the gate, which is the whole architecture restated
 * on every single line.
 */
function Rail({ event }: { event: AuditEvent }) {
  const reached = Boolean(event.razorpay_order_id);
  const failed = event.decision === 'payment_failed';

  const title = failed
    ? 'agent → gatekeeper → Razorpay (rail failed)'
    : reached
      ? 'agent → gatekeeper → Razorpay (order created)'
      : 'agent → gatekeeper ✕ — never reached Razorpay';

  return (
    <span
      className={cn('flex items-center', TONE[event.decision].rail)}
      title={title}
      data-testid="rail"
      data-rail-reached={reached && !failed}
      aria-hidden
    >
      <i className="block h-2 w-2 rounded-full bg-mute" />
      <i className="block h-px w-3.5 bg-mute opacity-60" />
      <i className="block h-2 w-2 rounded-full bg-mute" />
      <i className="block h-px w-3.5 bg-mute opacity-60" />
      <i
        className={cn(
          'block h-2 w-2 rounded-full border-[1.5px] border-current',
          reached && !failed ? 'bg-current' : 'bg-transparent',
        )}
      />
    </span>
  );
}

interface EventRowProps {
  event: AuditEvent;
  index: number;
  onJump: (eventId: string) => void;
}

export function EventRow({ event, index, onJump }: EventRowProps) {
  const [open, setOpen] = useState(false);
  const tone = TONE[event.decision];
  const budget = event.budget;

  return (
    <motion.article
      id={event.event_id}
      layout
      initial={{ opacity: 0, y: motionTokens.distance.sm }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.gentle, delay: Math.min(index * 0.035, 0.28) }}
      className="relative scroll-mt-24 overflow-hidden rounded-xl border border-hairline bg-panel"
      data-testid="event"
      data-decision={event.decision}
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', tone.edge)} aria-hidden />

      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        whileTap={{ scale: motionTokens.scale.subtle }}
        transition={springs.snappy}
        className="grid w-full grid-cols-[14px_118px_minmax(0,1fr)_auto] items-center gap-3 py-3 pl-4 pr-4 text-left hover:bg-bg-subtle sm:grid-cols-[14px_118px_minmax(0,1fr)_auto_auto_auto]"
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={springs.snappy}
          className="flex text-text-faint"
        >
          <ChevronRight size={13} />
        </motion.span>

        <span
          className={cn(
            'rounded-full border px-0 py-1 text-center text-[10px] font-bold uppercase tracking-[0.05em]',
            tone.pill,
          )}
        >
          {DECISION_LABEL[event.decision]}
        </span>

        <span className="min-w-0 truncate text-[13.5px] font-semibold">{event.item}</span>

        <span className="hidden rounded-md bg-mute-soft px-2 py-0.5 text-[11.5px] text-text-faint sm:inline">
          {event.category}
        </span>

        <span className="hidden sm:flex">
          <Rail event={event} />
        </span>

        <span className="tnum min-w-[84px] text-right text-[14px] font-semibold">
          {inr(event.amount_inr)}
        </span>
      </motion.button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.fast }}
            className="border-t border-hairline px-4 pb-4 pl-10 pt-3"
            data-testid="event-detail"
          >
            <p className="max-w-[68ch] text-[13px] leading-relaxed">{event.reason}</p>

            {event.violations && event.violations.length > 0 && (
              <div className="mt-3 grid gap-1.5">
                {event.violations.map((v) => (
                  <div
                    key={v.code}
                    data-testid="violation"
                    className="flex items-start gap-2.5 rounded-md border border-stop-line bg-stop-soft px-2.5 py-1.5 text-[12.5px] text-text-dim"
                  >
                    <code className="whitespace-nowrap pt-px font-mono text-[10.5px] font-bold text-stop">
                      {v.code}
                    </code>
                    <span>{v.message}</span>
                  </div>
                ))}
              </div>
            )}

            {budget && (
              <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-5 gap-y-2.5 border-t border-hairline pt-3">
                {(
                  [
                    ['Per-transaction cap', inr(budget.per_transaction_cap_inr)],
                    ['Approval threshold', inr(budget.step_up_threshold_inr)],
                    [
                      'Month spend',
                      `${inr(budget.month_spend_before_inr)} → ${inr(budget.month_spend_after_inr)}`,
                    ],
                    [
                      'Budget left',
                      `${inr(budget.monthly_remaining_before_inr)} → ${inr(budget.monthly_remaining_after_inr)}`,
                    ],
                  ] as Array<[string, string]>
                ).map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <p className="text-[10.5px] uppercase tracking-[0.05em] text-text-faint">{k}</p>
                    <p className="tnum text-[13px] font-semibold">{v}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3.5 flex flex-wrap gap-x-3.5 gap-y-1 border-t border-hairline pt-3 font-mono text-[11px] text-text-faint">
              <span>{event.event_id}</span>
              <span>{shortDate(event.timestamp)}</span>
              <span>{event.category}</span>
              {event.merchant && <span>{event.merchant}</span>}
              <span>
                {event.razorpay_order_id
                  ? `${event.razorpay_order_id}${event.razorpay_mock ? ' (mock)' : ''}`
                  : 'no razorpay call'}
              </span>
              <span>by {event.actor}</span>
              {event.retry_of_event_id && (
                <button
                  type="button"
                  onClick={() => onJump(event.retry_of_event_id!)}
                  className="border-b border-dotted border-brand-line text-brand hover:border-solid"
                >
                  ↩ retry of {event.retry_of_event_id}
                </button>
              )}
              {event.resolves_event_id && (
                <button
                  type="button"
                  onClick={() => onJump(event.resolves_event_id!)}
                  className="border-b border-dotted border-brand-line text-brand hover:border-solid"
                >
                  ✓ resolves {event.resolves_event_id}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
