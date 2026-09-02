import { motion } from 'motion/react';
import { Card, CardHeading } from '@/components/ui/primitives';
import { useCountUp } from '@/hooks/use-count-up';
import { motionTokens, springs } from '@/lib/motion';
import { inr } from '@/lib/utils';
import type { DashboardState } from '@/lib/api';

interface BudgetCardProps {
  budget: DashboardState['budget'];
  stats: DashboardState['stats'];
  paidCount: number;
  pendingCount: number;
}

export function BudgetCard({ budget, stats, paidCount, pendingCount }: BudgetCardProps) {
  const spend = useCountUp(budget.month_spend_inr);
  const blocked = useCountUp(stats.blocked_amount_inr);

  const pct =
    budget.monthly_cap_inr > 0
      ? Math.min(1, budget.month_spend_inr / budget.monthly_cap_inr)
      : 0;

  const figures: Array<{ n: number; label: string; className: string }> = [
    { n: paidCount, label: 'paid', className: 'text-ok' },
    { n: stats.blocked_count, label: 'blocked', className: 'text-stop' },
    { n: pendingCount, label: 'awaiting you', className: 'text-wait' },
  ];

  return (
    <Card className="p-5">
      <CardHeading>This month</CardHeading>

      <p data-testid="spend-figure" className="tnum mt-3 text-[32px] font-semibold leading-none tracking-[-0.025em]">
        {inr(Math.round(spend))}
      </p>
      <p className="mt-1.5 text-[12.5px] text-text-dim">
        spent of the {inr(budget.monthly_cap_inr)} monthly budget
      </p>

      {/* scaleX, never width - animating a layout property would cost a
          reflow on every frame. */}
      <div className="mt-4 h-2 overflow-hidden rounded-full border border-hairline bg-bg-subtle">
        <motion.div
          className="h-full origin-left rounded-full bg-brand"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: pct }}
          transition={{
            duration: motionTokens.duration.slow,
            ease: motionTokens.easing.smooth as unknown as [number, number, number, number],
          }}
        />
      </div>

      <div className="mt-2 flex justify-between text-[12px] text-text-dim">
        <span className="tnum">{Math.round(pct * 100)}% used</span>
        <span className="tnum">{inr(budget.monthly_remaining_inr)} left</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <motion.p
              key={`${f.label}-${f.n}`}
              initial={{ opacity: 0, y: -motionTokens.distance.xs }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.snappy}
              className={`tnum text-[21px] font-semibold leading-tight tracking-[-0.02em] ${f.className}`}
            >
              {f.n}
            </motion.p>
            <p className="text-[11px] text-text-dim">{f.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-hairline pt-4">
        <p className="tnum text-[21px] font-semibold tracking-[-0.02em] text-stop">
          {inr(Math.round(blocked))}
        </p>
        <p className="mt-0.5 text-[12px] text-text-dim">
          stopped by policy across {stats.blocked_count} blocked{' '}
          {stats.blocked_count === 1 ? 'attempt' : 'attempts'} — no payment was made
        </p>
      </div>
    </Card>
  );
}
