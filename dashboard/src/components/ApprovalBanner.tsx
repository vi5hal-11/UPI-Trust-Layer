import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/primitives';
import { motionTokens, springs } from '@/lib/motion';
import { inr } from '@/lib/utils';
import type { AuditEvent } from '@/lib/api';

interface ApprovalBannerProps {
  pending: AuditEvent[];
  onResolve: (eventId: string, approve: boolean) => Promise<void>;
  /** Approvals move money, so they are gated. Reads never are. */
  unlocked: boolean;
}

/**
 * The only actionable thing on the page, so it sits directly under the header
 * and is the one element allowed to draw attention to itself.
 */
export function ApprovalBanner({ pending, onResolve, unlocked }: ApprovalBannerProps) {
  const [busy, setBusy] = useState(false);

  async function handle(eventId: string, approve: boolean) {
    setBusy(true);
    try {
      await onResolve(eventId, approve);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence initial={false}>
      {pending.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: -motionTokens.distance.sm }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -motionTokens.distance.sm }}
          transition={springs.gentle}
          data-testid="approval-banner"
          className="relative overflow-hidden rounded-xl border border-wait-line bg-wait-soft p-4 pl-5"
        >
          <span className="absolute inset-y-0 left-0 w-[3px] bg-wait" aria-hidden />

          <h2 className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-wait">
            Waiting for your approval
          </h2>
          {!unlocked && (
            <p className="mt-1 text-[12.5px] text-text-dim">
              Unlock approvals in the header to release or decline this payment.
            </p>
          )}

          <div className="mt-3 grid gap-3">
            {pending.map((e) => (
              <div
                key={e.event_id}
                data-testid="approval-row"
                data-event-id={e.event_id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-wait-line pt-3 first:border-t-0 first:pt-0"
              >
                <div className="min-w-[260px] flex-1">
                  <p className="text-[13.5px] font-semibold">
                    {e.item} · <span className="tnum">{inr(e.amount_inr)}</span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-text-dim">{e.reason}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    disabled={busy || !unlocked}
                    title={unlocked ? undefined : 'Unlock approvals first'}
                    onClick={() => void handle(e.event_id, true)}
                  >
                    Approve
                  </Button>
                  <Button
                    disabled={busy || !unlocked}
                    title={unlocked ? undefined : 'Unlock approvals first'}
                    onClick={() => void handle(e.event_id, false)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
