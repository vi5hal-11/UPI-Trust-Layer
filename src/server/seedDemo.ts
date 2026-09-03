/**
 * Seed the four demo scenarios on boot when the audit trail is empty.
 *
 * Why this exists: a hosted demo usually runs on ephemeral storage, so the
 * SQLite file is gone after every restart and a visitor arrives at "Nothing has
 * been attempted yet" — which demonstrates nothing.
 *
 * The important part is HOW it seeds. It does not insert rows. Every scenario
 * below goes through the real gatekeeper: the real policy engine evaluates it,
 * a real Razorpay test-mode order is created for the ones policy allows, and
 * the resulting events are written by the same code path as any other purchase.
 *
 * That distinction is the whole point. Writing convincing-looking rows straight
 * into an audit trail would make it a stage set rather than evidence, in a
 * project whose entire argument is that the log can be trusted. These decisions
 * are real decisions; they are just made at startup rather than by a person.
 */
import type { Gatekeeper } from '../gatekeeper/service.js';
import type { AuditStore } from '../audit/store.js';

const SCENARIOS = [
  { item: 'whey protein powder 1kg', amount_inr: 800, category: 'groceries', merchant: 'BigBasket' },
  {
    item: 'mechanical gaming keyboard',
    amount_inr: 15_000,
    category: 'electronics',
    merchant: 'Amazon',
  },
  { item: 'adjustable phone stand', amount_inr: 1200, category: 'accessories', merchant: 'Amazon' },
  {
    item: 'annual music subscription',
    amount_inr: 1800,
    category: 'subscriptions',
    merchant: 'Spotify',
  },
] as const;

export interface SeedResult {
  seeded: boolean;
  decisions: number;
  reason?: string;
}

export async function seedDemoIfEmpty(
  gatekeeper: Gatekeeper,
  store: AuditStore,
): Promise<SeedResult> {
  if (store.list(1).length > 0) {
    return { seeded: false, decisions: 0, reason: 'the audit trail already has decisions' };
  }

  let decisions = 0;
  for (const intent of SCENARIOS) {
    try {
      await gatekeeper.attemptPurchase({ ...intent }, { actor: 'agent' });
      decisions += 1;
    } catch (err) {
      // A rail failure here must not stop the server booting. Whatever was
      // logged before the failure stays logged, because it really happened.
      return {
        seeded: decisions > 0,
        decisions,
        reason: `stopped after ${decisions}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return { seeded: true, decisions };
}
