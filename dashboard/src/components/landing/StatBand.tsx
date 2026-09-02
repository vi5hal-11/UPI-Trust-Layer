import { useEffect, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'motion/react';
import { motionTokens } from '@/lib/motion';

/**
 * Evidence of substance, as figures rather than adjectives.
 *
 * Every number here is real and checkable in the repo, which is the only
 * reason it is worth showing. A landing page that inflates its own numbers is
 * worse than one with none.
 */

interface Stat {
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  tone?: string;
}

const STATS: Stat[] = [
  { value: 68, label: 'unit tests on the trust boundary' },
  { value: 19, label: 'browser tests on the demo path' },
  { value: 3, label: 'rules broken at once, all reported', tone: 'text-stop' },
  { value: 15000, prefix: '₹', label: 'refused in the demo run', tone: 'text-stop' },
];

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

  const rendered =
    stat.value >= 1000 ? Math.round(shown).toLocaleString('en-IN') : String(Math.round(shown));

  return (
    <div className="min-w-0">
      <p
        ref={ref}
        className={`tnum text-[28px] font-semibold leading-none tracking-[-0.025em] ${stat.tone ?? ''}`}
      >
        {stat.prefix}
        {rendered}
        {stat.suffix}
      </p>
      <p className="mt-2 text-[12.5px] leading-snug text-text-dim">{stat.label}</p>
    </div>
  );
}

export function StatBand() {
  return (
    <div className="grid grid-cols-2 gap-6 rounded-xl border border-hairline bg-panel p-6 sm:grid-cols-4">
      {STATS.map((stat) => (
        <Counter key={stat.label} stat={stat} />
      ))}
    </div>
  );
}
