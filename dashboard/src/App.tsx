import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { Backdrop } from '@/components/Backdrop';
import { Header } from '@/components/Header';
import { MandateCard } from '@/components/MandateCard';
import { BudgetCard } from '@/components/BudgetCard';
import { ApprovalBanner } from '@/components/ApprovalBanner';
import { EventRow } from '@/components/EventRow';
import { Segmented, type SegmentOption } from '@/components/ui/segmented';
import { useDashboardState } from '@/hooks/use-dashboard-state';
import { useTheme } from '@/hooks/use-theme';
import { motionTokens, springs } from '@/lib/motion';
import { inr } from '@/lib/utils';
import { DECISION_GROUP, DECISION_LABEL, resolveStepUp } from '@/lib/api';

export default function App() {
  const { state, stale, arrivals, refresh } = useDashboardState();
  const { dark, toggle } = useTheme();
  const [tab, setTab] = useState('all');

  /* A decision landing is the live-demo moment. Announce it. */
  useEffect(() => {
    for (const e of arrivals) {
      const label = DECISION_LABEL[e.decision];
      const body = `${e.item} · ${inr(e.amount_inr)}`;
      if (e.decision === 'blocked') toast.error(`Blocked — ${body}`, { description: e.reason });
      else if (e.decision === 'step_up_required')
        toast.warning(`Needs your approval — ${body}`, { description: e.reason });
      else if (e.decision === 'payment_failed')
        toast.error(`Payment failed — ${body}`, { description: e.reason });
      else if (e.decision === 'step_up_denied') toast(`Declined — ${body}`);
      else toast.success(`${label} — ${body}`);
    }
  }, [arrivals]);

  const events = state?.events ?? [];

  const counts = useMemo(() => {
    const c = { all: events.length, paid: 0, blocked: 0, awaiting: 0, other: 0 };
    for (const e of events) {
      const g = DECISION_GROUP[e.decision];
      if (g && g in c) c[g as keyof typeof c] += 1;
    }
    return c;
  }, [events]);

  const options: SegmentOption[] = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'paid', label: 'Paid', count: counts.paid },
    { value: 'blocked', label: 'Blocked', count: counts.blocked },
    { value: 'awaiting', label: 'Awaiting you', count: counts.awaiting },
    { value: 'other', label: 'Declined / failed', count: counts.other },
  ];

  const visible = useMemo(
    () => (tab === 'all' ? events : events.filter((e) => DECISION_GROUP[e.decision] === tab)),
    [events, tab],
  );

  async function handleResolve(eventId: string, approve: boolean) {
    try {
      await resolveStepUp(eventId, approve);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reach the server.');
    }
  }

  /** A linked event may be filtered out of view, so show everything first. */
  function jumpTo(eventId: string) {
    setTab('all');
    requestAnimationFrame(() => {
      document.getElementById(eventId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  const paidCount = events.filter(
    (e) => e.decision === 'allowed' || e.decision === 'step_up_approved',
  ).length;

  return (
    <>
      <Backdrop />
      <Header mode={state?.mode ?? null} dark={dark} onToggleTheme={toggle} />

      <main className="mx-auto max-w-5xl px-5 pb-20">
        {!state ? (
          <p className="py-20 text-center text-[13.5px] text-text-faint">
            {stale ? 'Cannot reach the server — is it running?' : 'Connecting…'}
          </p>
        ) : (
          <>
            <div className="pt-5">
              <ApprovalBanner pending={state.pending_step_ups} onResolve={handleResolve} />
            </div>

            <motion.div
              initial={{ opacity: 0, y: motionTokens.distance.md }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: 0.05 }}
              className="mt-4 grid gap-4 md:grid-cols-2"
            >
              <MandateCard mandate={state.mandate} />
              <BudgetCard
                budget={state.budget}
                stats={state.stats}
                paidCount={paidCount}
                pendingCount={state.pending_step_ups.length}
              />
            </motion.div>

            <div className="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <h2 className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-text-faint">
                Decision log
              </h2>
              <p className="text-[12.5px] text-text-dim">
                {state.stats.decisions_logged}{' '}
                {state.stats.decisions_logged === 1 ? 'decision' : 'decisions'}, newest first
              </p>
              <div className="flex-1" />
              {stale && (
                <span className="text-[12px] font-semibold text-stop">
                  not updating — is the server running?
                </span>
              )}
            </div>

            <div className="mt-3">
              <Segmented value={tab} onValueChange={setTab} options={options} />
            </div>

            <div className="mt-3 grid gap-2">
              {visible.length === 0 ? (
                <p className="rounded-xl border border-dashed border-hairline-strong px-5 py-9 text-center text-[13.5px] text-text-faint">
                  {events.length === 0 ? (
                    <>
                      Nothing has been attempted yet. Run{' '}
                      <code className="rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[12.5px] text-brand">
                        npm run demo
                      </code>
                      , or POST an intent to{' '}
                      <code className="rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[12.5px] text-brand">
                        /api/intent
                      </code>
                      .
                    </>
                  ) : (
                    'No decisions in this category.'
                  )}
                </p>
              ) : (
                <AnimatePresence mode="popLayout" initial={false}>
                  {visible.map((e, i) => (
                    <EventRow key={e.event_id} event={e} index={i} onJump={jumpTo} />
                  ))}
                </AnimatePresence>
              )}
            </div>

            <footer className="mt-8 text-[11.5px] text-text-faint">
              {state.mode.live
                ? 'Orders are created against Razorpay test mode. No real money moves.'
                : 'Mock mode: every decision above is real and was made by the policy engine. Only the final Razorpay call is stubbed.'}
            </footer>
          </>
        )}
      </main>

      <Toaster
        theme={dark ? 'dark' : 'light'}
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ duration: 5000 }}
      />
    </>
  );
}
