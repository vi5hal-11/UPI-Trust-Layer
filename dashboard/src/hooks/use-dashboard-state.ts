import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchState, type AuditEvent, type DashboardState } from '@/lib/api';

const POLL_MS = 2000;

export interface UseDashboardState {
  state: DashboardState | null;
  stale: boolean;
  /** Events that appeared since the previous poll. Drives toasts. */
  arrivals: AuditEvent[];
  refresh: () => Promise<void>;
}

/**
 * Polls /api/state and only produces a new object when the payload actually
 * changed - so React doesn't re-render, and nothing re-animates, while
 * somebody is reading the page or recording it.
 */
export function useDashboardState(): UseDashboardState {
  const [state, setState] = useState<DashboardState | null>(null);
  const [stale, setStale] = useState(false);
  const [arrivals, setArrivals] = useState<AuditEvent[]>([]);

  const signature = useRef('');
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const failures = useRef(0);

  const tick = useCallback(async () => {
    try {
      const next = await fetchState();
      failures.current = 0;
      setStale(false);

      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature.current) return;
      signature.current = nextSignature;

      const ids = new Set(next.events.map((e) => e.event_id));
      // The first successful poll establishes a baseline. Without this every
      // event already in the log would toast on page load.
      if (primed.current) {
        const fresh = next.events.filter((e) => !seen.current.has(e.event_id));
        if (fresh.length) setArrivals(fresh);
      }
      seen.current = ids;
      primed.current = true;

      setState(next);
    } catch {
      failures.current += 1;
      if (failures.current >= 2) setStale(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    signature.current = '';
    await tick();
  }, [tick]);

  useEffect(() => {
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(id);
  }, [tick]);

  return { state, stale, arrivals, refresh };
}
