import { motion, useReducedMotion } from 'motion/react';
import { motionTokens, springs } from '@/lib/motion';

/**
 * A live miniature of the dashboard for the hero.
 *
 * Deliberately rendered from the same design tokens rather than pasted in as a
 * screenshot: a PNG goes stale the moment the UI changes, needs a second copy
 * for light mode, and costs bandwidth. This stays crisp at any size, follows
 * the theme, and cannot drift out of date.
 *
 * The rows are the real seeded demo scenarios, so it is a smaller view of the
 * product rather than an invented one.
 */

const ROWS = [
  { tone: 'ok', label: 'paid', item: 'whey protein powder', amount: '₹800', reached: true },
  { tone: 'stop', label: 'blocked', item: 'gaming keyboard', amount: '₹15,000', reached: false },
  { tone: 'wait', label: 'needs approval', item: 'music subscription', amount: '₹1,800', reached: false },
  { tone: 'ok', label: 'paid', item: 'phone stand', amount: '₹1,200', reached: true },
] as const;

const TONE: Record<string, { edge: string; pill: string; rail: string }> = {
  ok: { edge: 'bg-ok', pill: 'border-ok-line bg-ok-soft text-ok', rail: 'text-ok' },
  stop: { edge: 'bg-stop', pill: 'border-stop-line bg-stop-soft text-stop', rail: 'text-stop' },
  wait: { edge: 'bg-wait', pill: 'border-wait-line bg-wait-soft text-wait', rail: 'text-wait' },
};

export function DashboardPreview() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.lg }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.gentle, delay: 0.2 }}
      className="overflow-hidden rounded-xl border border-hairline bg-panel shadow-[0_20px_60px_-20px_rgb(0_0_0/0.35)]"
      aria-hidden
    >
      {/* window chrome, so it reads as an application */}
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-stop opacity-60" />
        <span className="h-2.5 w-2.5 rounded-full bg-wait opacity-60" />
        <span className="h-2.5 w-2.5 rounded-full bg-ok opacity-60" />
        <span className="ml-2 font-mono text-[10.5px] text-text-faint">/dashboard</span>
      </div>

      {/* budget summary */}
      <div className="border-b border-hairline px-4 py-3.5">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-text-faint">
          This month
        </p>
        <p className="tnum mt-1.5 text-[22px] font-semibold leading-none tracking-[-0.025em]">
          ₹3,800
        </p>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-bg-subtle">
          <motion.div
            className="h-full origin-left rounded-full bg-brand"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 0.38 }}
            transition={{ duration: reduce ? 0 : 0.9, delay: 0.6, ease: 'easeOut' }}
          />
        </div>
        <p className="mt-1.5 text-[10.5px] text-text-dim">38% of the ₹10,000 monthly cap</p>
      </div>

      {/* decision rows */}
      <div className="grid gap-1.5 p-3">
        {ROWS.map((row, i) => (
          <motion.div
            key={row.item}
            initial={{ opacity: 0, x: reduce ? 0 : -motionTokens.distance.sm }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springs.gentle, delay: 0.45 + i * 0.09 }}
            className="relative flex items-center gap-2.5 overflow-hidden rounded-lg border border-hairline bg-bg-subtle py-2 pl-3.5 pr-3"
          >
            <span className={`absolute inset-y-0 left-0 w-[2.5px] ${TONE[row.tone]!.edge}`} />
            <span
              className={`w-[86px] shrink-0 rounded-full border py-[3px] text-center text-[8.5px] font-bold uppercase tracking-[0.04em] ${TONE[row.tone]!.pill}`}
            >
              {row.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{row.item}</span>

            {/* the rail indicator, same idea as the real row */}
            <span className={`hidden items-center sm:flex ${TONE[row.tone]!.rail}`}>
              <i className="block h-1.5 w-1.5 rounded-full bg-mute" />
              <i className="block h-px w-2.5 bg-mute opacity-60" />
              <i className="block h-1.5 w-1.5 rounded-full bg-mute" />
              <i className="block h-px w-2.5 bg-mute opacity-60" />
              <i
                className={`block h-1.5 w-1.5 rounded-full border border-current ${row.reached ? 'bg-current' : 'bg-transparent'}`}
              />
            </span>

            <span className="tnum shrink-0 text-[11.5px] font-semibold">{row.amount}</span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
