import { motion } from 'motion/react';
import { useDecorativeMotion } from '@/lib/motion';

/**
 * Two very low-opacity washes that drift behind everything, so the glass in
 * the header has something moving to sample and the page does not look frozen
 * between decisions.
 *
 * Purely decorative, so it is the first thing switched off for reduced motion
 * or a low-core machine. Fixed and pointer-events-none: it can never intercept
 * a click or add a scrollbar.
 */
export function Backdrop() {
  const animateBackdrop = useDecorativeMotion();

  const base = 'absolute rounded-full blur-[110px] will-change-transform';

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <motion.div
        className={`${base} -left-[15%] -top-[20%] h-[46vw] w-[46vw]`}
        style={{ background: 'var(--aurora-1)' }}
        animate={animateBackdrop ? { x: [0, 70, 0], y: [0, 44, 0] } : undefined}
        transition={{ duration: 34, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className={`${base} -right-[12%] top-[8%] h-[38vw] w-[38vw]`}
        style={{ background: 'var(--aurora-2)' }}
        animate={animateBackdrop ? { x: [0, -56, 0], y: [0, 66, 0] } : undefined}
        transition={{ duration: 42, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
