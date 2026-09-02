/**
 * A small fixed-window rate limiter.
 *
 * Deliberately not `express-rate-limit`: this service needs two limits on two
 * routes, and a dependency whose behaviour a reader has to go and look up is a
 * worse trade than twenty lines they can read here.
 *
 * In-memory, so it is per-process and resets on deploy. That is the honest
 * limit of it: it stops a script hammering the demo, not a distributed
 * attacker. Anything stronger belongs at the platform edge, and the README
 * says so rather than implying this is DDoS protection.
 */
import type { NextFunction, Request, Response } from 'express';

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export function rateLimit({ windowMs, max }: RateLimitOptions) {
  const hits = new Map<string, Window>();

  // Unbounded growth would be a slow memory leak on a long-lived process.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, window] of hits) {
      if (window.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref?.();

  return function limiter(req: Request, res: Response, next: NextFunction): void {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const window = hits.get(key);

    if (!window || window.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    window.count += 1;
    if (window.count <= max) {
      next();
      return;
    }

    const retryAfterS = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterS));
    res.status(429).json({
      error: `Too many requests. Try again in ${retryAfterS}s.`,
    });
  };
}
