import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { motionTokens } from '@/lib/motion';

/**
 * The thesis, shown instead of described.
 *
 * A request leaves the agent, reaches the gatekeeper, and then either
 * continues to Razorpay or visibly stops. Alternating the two is the whole
 * point: the same journey, two endings, decided by a pure function rather than
 * by whatever the model asked for.
 *
 * This replaced an ASCII diagram in a <pre>. The mechanism is the one idea a
 * reader must leave with, so it gets essentially the entire motion budget on
 * this page.
 */

const NODES = [
  { x: 90, label: 'Shopping agent', sub: 'no keys, no rails' },
  { x: 330, label: 'Gatekeeper', sub: 'deterministic' },
  { x: 570, label: 'Razorpay', sub: 'test mode' },
] as const;

type Outcome = 'allowed' | 'blocked';

export function RailDiagram() {
  const reduce = useReducedMotion();
  const [outcome, setOutcome] = useState<Outcome>('blocked');
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setOutcome((o) => (o === 'blocked' ? 'allowed' : 'blocked'));
      setRun((r) => r + 1);
    }, 4200);
    return () => clearInterval(id);
  }, [reduce]);

  const blocked = outcome === 'blocked';
  const stopX = blocked ? NODES[1].x : NODES[2].x;
  const accent = blocked ? 'var(--stop)' : 'var(--ok)';

  return (
    <figure className="m-0">
      <div className="overflow-x-auto rounded-xl border border-hairline bg-panel p-6">
        <svg
          viewBox="0 0 660 190"
          className="mx-auto block h-auto w-full min-w-[560px] max-w-[660px]"
          role="img"
          aria-label="A purchase request travels from the shopping agent to the gatekeeper. The gatekeeper either forwards it to Razorpay or stops it there."
        >
          {/* the rail */}
          <line
            x1={NODES[0].x}
            y1={70}
            x2={NODES[2].x}
            y2={70}
            stroke="var(--hairline-strong)"
            strokeWidth={2}
          />

          {/* the segment actually travelled, drawn over the rail */}
          <motion.line
            key={`travelled-${run}`}
            x1={NODES[0].x}
            y1={70}
            x2={stopX}
            y2={70}
            stroke={accent}
            strokeWidth={2}
            initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: reduce ? 0 : 1.1, ease: 'easeInOut' }}
          />

          {NODES.map((node, i) => {
            // The rail node greys out when the request never got there.
            const unreached = blocked && i === 2;
            return (
              <g key={node.label}>
                <circle
                  cx={node.x}
                  cy={70}
                  r={11}
                  fill="var(--panel)"
                  stroke={unreached ? 'var(--hairline-strong)' : accent}
                  strokeWidth={2}
                  opacity={unreached ? 0.5 : 1}
                />
                <text
                  x={node.x}
                  y={112}
                  textAnchor="middle"
                  className="fill-[var(--text)] text-[13px] font-semibold"
                  opacity={unreached ? 0.45 : 1}
                >
                  {node.label}
                </text>
                <text
                  x={node.x}
                  y={130}
                  textAnchor="middle"
                  className="fill-[var(--text-faint)] text-[11px]"
                  opacity={unreached ? 0.45 : 1}
                >
                  {node.sub}
                </text>
              </g>
            );
          })}

          {/* the request itself */}
          <motion.circle
            key={`packet-${run}`}
            cy={70}
            r={5.5}
            fill={accent}
            initial={{ cx: NODES[0].x, opacity: 0 }}
            animate={
              reduce
                ? { cx: stopX, opacity: 1 }
                : { cx: [NODES[0].x, stopX], opacity: [0, 1, 1] }
            }
            transition={{ duration: reduce ? 0 : 1.1, ease: 'easeInOut' }}
          />

          {/* refusal mark, only on the blocked run */}
          {blocked && (
            <motion.g
              key={`stop-${run}`}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: reduce ? 0 : 1.15, duration: 0.25 }}
              style={{ transformOrigin: `${NODES[1].x}px 70px` }}
            >
              <line
                x1={NODES[1].x + 26}
                y1={58}
                x2={NODES[1].x + 46}
                y2={82}
                stroke="var(--stop)"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <line
                x1={NODES[1].x + 46}
                y1={58}
                x2={NODES[1].x + 26}
                y2={82}
                stroke="var(--stop)"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </motion.g>
          )}

          {/* what just happened, in words */}
          <motion.text
            key={`caption-${run}`}
            x={330}
            y={168}
            textAnchor="middle"
            className="text-[12.5px] font-semibold"
            fill={accent}
            initial={{ opacity: 0, y: 174 }}
            animate={{ opacity: 1, y: 168 }}
            transition={{ delay: reduce ? 0 : 1.25, duration: 0.3 }}
          >
            {blocked
              ? 'Blocked at the gate — 0 calls to Razorpay'
              : 'Within the mandate — order created'}
          </motion.text>
        </svg>
      </div>

      <figcaption className="mt-3 text-[12.5px] leading-relaxed text-text-faint">
        The model holds no key, no endpoint and no import path to the payment client. Its
        entire capability surface is one tool, and a pure function decides what happens next.
      </figcaption>
    </figure>
  );
}

/** Shared by the sections that want a quiet, non-decorative entrance. */
export const revealTransition = {
  duration: motionTokens.duration.normal,
  ease: motionTokens.easing.smooth as unknown as [number, number, number, number],
};
