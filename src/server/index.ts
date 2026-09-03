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
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { AuditStore } from '../audit/store.js';
import { isMandateExpired, loadMandate } from '../gatekeeper/mandate.js';
import { Gatekeeper, GatekeeperError } from '../gatekeeper/service.js';
import { agentAvailable, runShoppingAgent } from '../agent/shoppingAgent.js';
import { isLiveMode, modeLabel } from '../razorpay/client.js';
import { IdempotencyConflict, IdempotencyStore } from '../audit/idempotency.js';
import { MandateStore } from '../audit/mandateStore.js';
import { MandateScopeSchema } from '../types.js';
import {
  clearSessionCookie,
  isCorrectSecret,
  isValidSession,
  issueSession,
  readSessionCookie,
  requireApproval,
  setSessionCookie,
} from './auth.js';
import { rateLimit } from './rateLimit.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The dashboard is a Vite/React build, not a hand-written file. `npm start`
 * runs the build first (see the prestart script), so this directory exists by
 * the time the server boots.
 */
const dashboardDir = resolve(here, '../../dashboard/dist');

/** How many events to scan when totalling what policy has refused. */
const STATS_WINDOW = 1000;

export function createApp(gatekeeper: Gatekeeper, store: AuditStore, mandates: MandateStore) {
  const app = express();
  const idempotency = new IdempotencyStore(store.connection);

  // Behind a proxy (Railway, Render, Fly) the client IP is in X-Forwarded-For.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(dashboardDir));

  /** Liveness: the process is up. Used by the platform's health check. */
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime_s: Math.round(process.uptime()) });
  });

  /** Readiness: the parts that must work before traffic is useful. */
  app.get('/ready', (_req: Request, res: Response) => {
    try {
      store.list(1);
      res.json({ status: 'ready', mandate: gatekeeper.mandateInForce.mandate_id });
    } catch (err) {
      res.status(503).json({
        status: 'not-ready',
        error: err instanceof Error ? err.message : 'audit store unavailable',
      });
    }
  });

  /* ---- session: unlocks approvals, nothing else ---- */

  app.post('/api/session', rateLimit({ windowMs: 60_000, max: 5 }), (req: Request, res: Response) => {
    const secret = (req.body as { secret?: unknown } | undefined)?.secret;
    if (!isCorrectSecret(secret)) {
      // Deliberately vague: do not confirm whether a secret is even configured.
      res.status(401).json({ error: 'That approval secret is not correct.' });
      return;
    }
    setSessionCookie(res, issueSession());
    res.json({ unlocked: true });
  });

  app.delete('/api/session', (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ unlocked: false });
  });

  app.get('/api/session', (req: Request, res: Response) => {
    res.json({ unlocked: isValidSession(readSessionCookie(req)) });
  });

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

  /**
   * Raw intent. Deliberately unvalidated here - the gatekeeper validates.
   *
   * Honours an optional `Idempotency-Key` header: an agent that retries after a
   * timeout must not create a second real order for one intent.
   */
  app.post(
    '/api/intent',
    rateLimit({ windowMs: 60_000, max: 30 }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { retry_of_event_id, ...intent } = (req.body ?? {}) as Record<string, unknown>;
        const key = req.header('Idempotency-Key')?.trim();
        const requestHash = IdempotencyStore.hashRequest(req.body ?? {});

        if (key) {
          const hit = idempotency.lookup(key, requestHash);
          if (hit) {
            // Replay the original outcome verbatim. No policy evaluation, no
            // second Razorpay order, no second audit event.
            res.setHeader('Idempotent-Replay', 'true');
            res.type('application/json').send(hit.response_json);
            return;
          }
        }

        const outcome = await gatekeeper.attemptPurchase(intent, {
          actor: 'agent',
          ...(typeof retry_of_event_id === 'string' ? { retry_of_event_id } : {}),
        });

        if (key) idempotency.record(key, requestHash, outcome.event.event_id, outcome);
        res.json(outcome);
      } catch (err) {
        next(err);
      }
    },
  );

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

  app.post('/api/stepup/:id/approve', requireApproval, async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await gatekeeper.resolveStepUp(String(req.params.id), true));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/stepup/:id/deny', requireApproval, async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await gatekeeper.resolveStepUp(String(req.params.id), false));
    } catch (err) {
      next(err);
    }
  });

  /* ---- mandates ---- */

  app.get('/api/mandates', (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ mandates: mandates.list(), active: gatekeeper.mandateInForce.mandate_id });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Issuing a mandate sets what the agent may spend, so it is strictly more
   * powerful than approving a single purchase and sits behind the same gate.
   *
   * A mandate is never edited: this supersedes the previous one and leaves it
   * in place, because audit events reference the mandate that authorised them.
   */
  app.post('/api/mandates', requireApproval, (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const scope = MandateScopeSchema.safeParse(body.scope);
      if (!scope.success) {
        const detail = scope.error.issues
          .map((i) => `scope.${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        res.status(400).json({ error: `That is not a valid mandate scope - ${detail}` });
        return;
      }

      const principal = typeof body.principal === 'string' ? body.principal.trim() : '';
      if (!principal) {
        res.status(400).json({ error: 'principal is required - who this mandate is issued to.' });
        return;
      }

      const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : '';
      if (Number.isNaN(new Date(expiresAt).getTime())) {
        res.status(400).json({ error: 'expires_at must be an ISO date. A mandate must expire.' });
        return;
      }

      res.status(201).json({ mandate: mandates.issue({ principal, scope: scope.data, expires_at: expiresAt }) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/mandates/:id/revoke', requireApproval, (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      if (!mandates.revoke(id)) {
        res.status(404).json({ error: `No active mandate "${id}" to revoke.` });
        return;
      }
      res.json({ revoked: id, active: mandates.active()?.mandate_id ?? null });
    } catch (err) {
      next(err);
    }
  });

  /**
   * SPA fallback. The client renders the landing page at / and the dashboard at
   * /dashboard from one bundle, so a refresh or a shared link on /dashboard has
   * to return index.html rather than a 404.
   *
   * Deliberately after the API routes and narrow: an unknown /api/* path should
   * still 404 as JSON rather than quietly returning a web page.
   */
  app.get(/^\/(?!api\/).*/, (_req: Request, res: Response, next: NextFunction) => {
    const entry = resolve(dashboardDir, 'index.html');
    if (!existsSync(entry)) {
      next();
      return;
    }
    res.sendFile(entry);
  });

  // Errors say what happened. Nothing is swallowed.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      err instanceof GatekeeperError || err instanceof IdempotencyConflict ? err.status : 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (status >= 500) console.error('[server]', err);
    res.status(status).json({ error: message });
  });

  return app;
}

function main(): void {
  const store = new AuditStore(env.auditDbPath);
  const mandateStore = new MandateStore(store.connection);

  // First run only: put the seed mandate in the database. After that the
  // database is the source of truth and the seed file is never read again.
  const seeded = mandateStore.count() === 0;
  if (seeded) mandateStore.seedIfEmpty(loadMandate(env.policyPath));

  /** Resolved per decision, so a newly issued mandate applies immediately. */
  const currentMandate = () => {
    const active = mandateStore.active();
    if (!active) {
      throw new GatekeeperError(
        'No mandate is in force - every one has been revoked. Issue a new mandate ' +
          'before the agent can attempt a purchase.',
        409,
      );
    }
    return active;
  };

  const mandate = currentMandate();
  const gatekeeper = new Gatekeeper({ mandate: currentMandate, store });
  const app = createApp(gatekeeper, store, mandateStore);

  if (!existsSync(dashboardDir)) {
    console.error(
      `\n  The dashboard has not been built yet (${dashboardDir} is missing).\n` +
        `  Run "npm run build" and start again, or just use "npm start", which builds first.\n`,
    );
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    const { scope } = mandate;
    console.log('');
    console.log('  UPI Agent Trust Layer');
    console.log(`  mode      ${modeLabel()}`);
    console.log(
      `  agent     ${agentAvailable() ? `${env.agentModel} via ${env.agentBaseUrl}` : 'direct mode - no AGENT_API_KEY set'}`,
    );
    console.log(
      `  mandate   ${mandate.mandate_id} for ${mandate.principal}${seeded ? ' (seeded on first run)' : ''}`,
    );
    console.log(
      `            cap ₹${scope.per_transaction_cap_inr}/txn, ₹${scope.monthly_cap_inr}/month, ` +
        `approval over ₹${scope.step_up_threshold_inr}`,
    );
    console.log(`            expires ${mandate.expires_at}`);
    console.log(`  audit db  ${resolve(env.auditDbPath)}`);
    console.log(`  dashboard http://localhost:${env.port}`);
    console.log('');
  });

  // A raw EADDRINUSE stack trace tells a reader nothing they can act on.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n  Port ${env.port} is already in use - something else is running there,\n` +
          `  most likely an earlier "npm start" or "npm run dev" of this project.\n\n` +
          `  Stop it, or start on another port:  PORT=3001 npm start\n`,
      );
      process.exit(1);
    }
    throw err;
  });
}

// Only run the server when this file is the entry point, so tests and the demo
// runner can import createApp without binding a port.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
