/**
 * Express API plus the static dashboard.
 *
 * Two ways in for a purchase: POST /api/intent (raw, for curl and the demo
 * runner) and POST /api/chat (natural language, through the LLM agent). Both
 * end up at the same gatekeeper, and the decision is identical either way -
 * which is the point. The step-up endpoints are reachable only from the
 * dashboard; the agent has no route to them.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { AuditStore } from '../audit/store.js';
import { isMandateExpired, loadMandate } from '../gatekeeper/mandate.js';
import { Gatekeeper, GatekeeperError } from '../gatekeeper/service.js';
import { agentAvailable, runShoppingAgent } from '../agent/shoppingAgent.js';
import { isLiveMode, modeLabel } from '../razorpay/client.js';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardDir = resolve(here, '../../dashboard');

/** How many events to scan when totalling what policy has refused. */
const STATS_WINDOW = 1000;

export function createApp(gatekeeper: Gatekeeper, store: AuditStore) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(dashboardDir));

  app.get('/api/state', (_req: Request, res: Response) => {
    const mandate = gatekeeper.mandateInForce;
    const now = new Date();
    const spend = gatekeeper.monthSpendInr();
    const recent = store.list(STATS_WINDOW);

    const blocked = recent.filter((event) => event.decision === 'blocked');
    const blockedAmount = blocked.reduce((sum, event) => sum + event.amount_inr, 0);

    res.json({
      mode: {
        live: isLiveMode(),
        label: modeLabel(),
        agent_available: agentAvailable(),
        agent_model: env.agentModel,
      },
      mandate: {
        mandate_id: mandate.mandate_id,
        principal: mandate.principal,
        issued_at: mandate.issued_at,
        expires_at: mandate.expires_at,
        expired: isMandateExpired(mandate, now),
        integrity_hash: mandate.integrity_hash ?? null,
        scope: mandate.scope,
      },
      budget: {
        per_transaction_cap_inr: mandate.scope.per_transaction_cap_inr,
        monthly_cap_inr: mandate.scope.monthly_cap_inr,
        step_up_threshold_inr: mandate.scope.step_up_threshold_inr,
        month_spend_inr: spend,
        monthly_remaining_inr: Math.max(0, mandate.scope.monthly_cap_inr - spend),
      },
      stats: {
        decisions_logged: recent.length,
        blocked_count: blocked.length,
        /** What the policy layer refused to spend. The number judges look at. */
        blocked_amount_inr: Math.round(blockedAmount * 100) / 100,
      },
      pending_step_ups: store.pendingStepUps(mandate.mandate_id),
      events: recent.slice(0, 100),
    });
  });

  /** Raw intent. Deliberately unvalidated here - the gatekeeper validates. */
  app.post('/api/intent', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { retry_of_event_id, ...intent } = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await gatekeeper.attemptPurchase(intent, {
        actor: 'agent',
        ...(typeof retry_of_event_id === 'string' ? { retry_of_event_id } : {}),
      });
      res.json(outcome);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/chat', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const message = (req.body as { message?: unknown } | undefined)?.message;
      if (typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Send { "message": "what you want to buy" }.' });
        return;
      }
      const run = await runShoppingAgent(message.trim(), gatekeeper);
      res.json(run);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/stepup/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await gatekeeper.resolveStepUp(String(req.params.id), true));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/stepup/:id/deny', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await gatekeeper.resolveStepUp(String(req.params.id), false));
    } catch (err) {
      next(err);
    }
  });

  // Errors say what happened. Nothing is swallowed.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof GatekeeperError ? err.status : 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (status >= 500) console.error('[server]', err);
    res.status(status).json({ error: message });
  });

  return app;
}

function main(): void {
  const mandate = loadMandate(env.policyPath);
  const store = new AuditStore(env.auditDbPath);
  const gatekeeper = new Gatekeeper({ mandate, store });
  const app = createApp(gatekeeper, store);

  app.listen(env.port, () => {
    const { scope } = mandate;
    console.log('');
    console.log('  UPI Agent Trust Layer');
    console.log(`  mode      ${modeLabel()}`);
    console.log(
      `  agent     ${agentAvailable() ? `available (${env.agentModel})` : 'direct mode - no ANTHROPIC_API_KEY set'}`,
    );
    console.log(`  mandate   ${mandate.mandate_id} for ${mandate.principal}`);
    console.log(
      `            cap ₹${scope.per_transaction_cap_inr}/txn, ₹${scope.monthly_cap_inr}/month, ` +
        `approval over ₹${scope.step_up_threshold_inr}`,
    );
    console.log(`            expires ${mandate.expires_at}`);
    console.log(`  audit db  ${resolve(env.auditDbPath)}`);
    console.log(`  dashboard http://localhost:${env.port}`);
    console.log('');
  });
}

// Only run the server when this file is the entry point, so tests and the demo
// runner can import createApp without binding a port.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
