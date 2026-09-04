import { useEffect, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'motion/react';
import { motionTokens } from '@/lib/motion';
import { fetchState } from '@/lib/api';
import { inr } from '@/lib/utils';

/**
 * Evidence of substance, as figures rather than adjectives.
 *
 * Nothing here is typed in by hand, on purpose. The test counts are computed
 * from the suites at build time; the decision figures are read from the live
 * audit trail on load. Earlier these were literals, and they were wrong within
 * a day — the page claimed 68 unit tests when there were 78.
 *
 * A number a human has to remember to update is a number that will be stale,
 * and a stale boast on a page whose argument is "the log can be trusted" costs
 * more than it earns.
 */

declare const __UNIT_TESTS__: number;
declare const __E2E_TESTS__: number;

interface Stat {
  value: number;
  label: string;
  format?: (n: number) => string;
  tone?: string;
  live?: boolean;
}

function Counter({ stat }: { stat: Stat }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(stat.value);
      return;
    }
    const controls = animate(0, stat.value, {
      duration: motionTokens.duration.slow,
      ease: motionTokens.easing.smooth as unknown as [number, number, number, number],
      onUpdate: (v) => setShown(v),
    });
    return () => controls.stop();
  }, [inView, reduce, stat.value]);

  const rounded = Math.round(shown);
  const rendered = stat.format ? stat.format(rounded) : String(rounded);

  return (
    <div className="min-w-0">
      <p
        ref={ref}
        className={`tnum text-[28px] font-semibold leading-none tracking-[-0.025em] ${stat.tone ?? ''}`}
      >
        {rendered}
      </p>
      <p className="mt-2 text-[12.5px] leading-snug text-text-dim">{stat.label}</p>
    </div>
  );
}

export function StatBand() {
  const [live, setLive] = useState<{ blocked: number; refused: number; decisions: number } | null>(
    null,
  );

  useEffect(() => {
    // If the API is unreachable the band simply shows what it can. A landing
    // page must not break because the service behind it is asleep.
    void fetchState()
      .then((state) =>
        setLive({
          blocked: state.stats.blocked_count,
          refused: state.stats.blocked_amount_inr,
          decisions: state.stats.decisions_logged,
        }),
      )
      .catch(() => setLive(null));
  }, []);

  const stats: Stat[] = [
    { value: __UNIT_TESTS__, label: 'unit tests on the trust boundary' },
    { value: __E2E_TESTS__, label: 'browser tests on the demo path' },
    {
      value: live?.decisions ?? 0,
      label: 'decisions on the live audit trail',
      live: true,
    },
    {
      value: live?.refused ?? 0,
      format: (n) => inr(n),
      label: 'refused by policy, live',
      tone: 'text-stop',
      live: true,
    },
  ];

  return (
    <div className="rounded-xl border border-hairline bg-panel p-6">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {stats.map((stat) => (
          <Counter key={stat.label} stat={stat} />
        ))}
      </div>

      <p className="mt-5 border-t border-hairline pt-4 text-[11.5px] text-text-faint">
        Test counts are computed from the suites at build time. The last two are read from the
        running service&rsquo;s audit trail — they are not claims, they are what the gatekeeper has
        actually done.
      </p>
    </div>
  );
}
