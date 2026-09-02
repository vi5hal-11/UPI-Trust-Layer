import { useReducedMotion } from 'motion/react';

/**
 * The single source of motion values. Components never hardcode a duration,
 * an easing curve, or a spring config - they read them from here, so the whole
 * dashboard moves with one voice.
 */
export const motionTokens = {
  duration: {
    instant: 0.08,
    fast: 0.18,
    normal: 0.35,
    slow: 0.6,
    crawl: 1.0,
  },
  easing: {
    smooth: [0.22, 1, 0.36, 1],
    sharp: [0.4, 0, 0.2, 1],
    bounce: [0.34, 1.56, 0.64, 1],
    linear: [0, 0, 1, 1],
  },
  distance: { xs: 4, sm: 8, md: 16, lg: 24, xl: 48 },
  scale: { subtle: 0.98, press: 0.95, pop: 1.04 },
} as const;

export const springs = {
  snappy: { type: 'spring', stiffness: 300, damping: 30 },
  gentle: { type: 'spring', stiffness: 120, damping: 14 },
  bouncy: { type: 'spring', stiffness: 400, damping: 10 },
  instant: { type: 'spring', stiffness: 600, damping: 35 },
  release: { type: 'spring', stiffness: 200, damping: 20, restDelta: 0.001 },
} as const;

/** Never read navigator at module level. */
export function isLowEnd(): boolean {
  return typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;
}

/**
 * Entrance choreography: opacity + transform only, and transform is dropped
 * entirely when the reader has asked for reduced motion.
 */
export function useSafeMotion(distance: number = motionTokens.distance.md) {
  const reduce = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduce ? 0 : distance },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduce ? 0 : -distance },
  };
}

/** True when decorative (non-essential) motion should run at all. */
export function useDecorativeMotion(): boolean {
  const reduce = useReducedMotion();
  return !reduce && !isLowEnd();
}
