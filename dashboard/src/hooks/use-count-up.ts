import { useEffect, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { motionTokens } from '@/lib/motion';

/**
 * Animates from the previous value to the next one when a decision lands, so
 * the month's spend visibly moves rather than snapping. Returns the number
 * itself, not a MotionValue, so callers can still format it as rupees.
 *
 * Honours reduced motion by jumping straight to the target.
 */
export function useCountUp(target: number): number {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(target);

  useEffect(() => {
    if (reduce) {
      setDisplay(target);
      return;
    }
    const controls = animate(display, target, {
      duration: motionTokens.duration.slow,
      ease: motionTokens.easing.smooth as unknown as [number, number, number, number],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
    // `display` is deliberately excluded: including it would restart the
    // animation on every frame it emits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce]);

  return display;
}
