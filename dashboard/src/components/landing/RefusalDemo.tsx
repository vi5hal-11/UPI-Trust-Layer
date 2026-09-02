import { motion, useReducedMotion } from 'motion/react';
import { motionTokens, springs } from '@/lib/motion';

/**
 * The money shot, played as a sequence rather than shown as a still.
 *
 * The order matters and is the argument: the request arrives, three separate
 * rules break, and only then does the punchline land - nothing was charged.
 * Previously "0 calls to Razorpay" was 11px grey text at the bottom of a card,
 * which buried the single most important fact on the page.
 */

const VIOLATIONS = [
  ['CATEGORY_DENIED', "'electronics' is on the blocked list for this mandate"],
  ['PER_TRANSACTION_CAP_EXCEEDED', '₹15,000 is over the ₹2,000 per-transaction cap'],
  [
    'MONTHLY_CAP_EXCEEDED',
    "this would take September's spending to ₹18,800, over the ₹10,000 monthly cap",
  ],
] as const;

export function RefusalDemo() {
  const reduce = useReducedMotion();

  // Each step waits for the one before it, so a reader's eye is led rather
  // than asked to take in six things at once.
  const step = (i: number) => (reduce ? 0 : 0.35 + i * 0.42);

  return (
    <motion.div
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0 }}
      className="overflow-hidden rounded-xl border border-hairline bg-panel"
    >
      {/* the request */}
      <motion.div
        variants={{
          hidden: { opacity: 0, y: reduce ? 0 : -motionTokens.distance.sm },
          shown: { opacity: 1, y: 0 },
        }}
        transition={{ ...springs.gentle, delay: reduce ? 0 : 0.1 }}
        className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3.5"
      >
        <span className="rounded-full border border-stop-line bg-stop-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.05em] text-stop">
          blocked
        </span>
        <span className="text-[13.5px] font-semibold">mechanical gaming keyboard</span>
        <span className="rounded-md bg-mute-soft px-2 py-0.5 text-[11.5px] text-text-faint">
          electronics
        </span>
        <span className="flex-1" />
        <span className="tnum text-[15px] font-semibold">₹15,000</span>
      </motion.div>

      <div className="grid gap-1.5 p-4">
        {VIOLATIONS.map(([code, message], i) => (
          <motion.div
            key={code}
            variants={{
              hidden: { opacity: 0, x: reduce ? 0 : -motionTokens.distance.md },
              shown: { opacity: 1, x: 0 },
            }}
            transition={{ ...springs.gentle, delay: step(i) }}
            className="flex items-start gap-2.5 rounded-md border border-stop-line bg-stop-soft px-2.5 py-2 text-[12.5px] text-text-dim"
          >
            <code className="whitespace-nowrap pt-px font-mono text-[10.5px] font-bold text-stop">
              {code}
            </code>
            <span>{message}</span>
          </motion.div>
        ))}

        {/* the punchline - deliberately the largest thing here */}
        <motion.div
          variants={{
            hidden: { opacity: 0, y: reduce ? 0 : motionTokens.distance.sm },
            shown: { opacity: 1, y: 0 },
          }}
          transition={{ ...springs.gentle, delay: step(VIOLATIONS.length) }}
          className="mt-3 border-t border-hairline pt-4"
        >
          <p className="text-[26px] font-semibold leading-none tracking-[-0.025em] text-ok">
            0 calls to Razorpay
          </p>
          <p className="mt-2 text-[13px] text-text-dim">
            Refused before the payment rail, not reversed after it. There is no order to
            cancel, because no order was ever created.
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}
