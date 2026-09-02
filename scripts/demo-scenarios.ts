/**
 * The four scenarios, against a fresh database, with no API keys required.
 *
 *   npm run demo          direct mode - intents go straight to the gatekeeper
 *   npm run demo:agent    a real LLM decides what to ask for (needs a key)
 *
 * The decisions are identical either way. That is the point: the model changes
 * what gets ASKED for, never what gets ALLOWED.
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../src/config/env.js';
import { AuditStore } from '../src/audit/store.js';
import { loadMandate } from '../src/gatekeeper/mandate.js';
import { formatInr } from '../src/gatekeeper/policyEngine.js';
import { Gatekeeper, type PaymentRail } from '../src/gatekeeper/service.js';
import { createOrder, modeLabel } from '../src/razorpay/client.js';
import { agentAvailable, runShoppingAgent } from '../src/agent/shoppingAgent.js';
import type { Decision } from '../src/types.js';

const useAgent = process.argv.includes('--agent');

/* ------------------------------------------------------------------ paint - */

const paint = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  green: '[32m',
  red: '[31m',
  amber: '[33m',
  blue: '[36m',
  grey: '[90m',
  magenta: '[35m',
};

const DECISION_STYLE: Record<Decision, { label: string; colour: string }> = {
  allowed: { label: '  PAID   ', colour: paint.green },
  blocked: { label: ' BLOCKED ', colour: paint.red },
  step_up_required: { label: ' PARKED  ', colour: paint.amber },
  step_up_approved: { label: 'APPROVED ', colour: paint.green },
  step_up_denied: { label: 'DECLINED ', colour: paint.grey },
  payment_failed: { label: ' FAILED  ', colour: paint.magenta },
};

const line = (text = '') => console.log(text);
const rule = () => line(paint.grey + '─'.repeat(78) + paint.reset);

function heading(n: number, title: string, expectation: string): void {
  line('');
  line(`${paint.bold}Scenario ${n}${paint.reset}  ${title}`);
  line(`${paint.grey}            ${expectation}${paint.reset}`);
}

function verdict(decision: Decision, reason: string, orderId: string | null, mock: boolean): void {
  const style = DECISION_STYLE[decision];
  const order = orderId
    ? `${paint.grey}${orderId}${mock ? ' (mock)' : ''}${paint.reset}`
    : `${paint.grey}no Razorpay call${paint.reset}`;
  line(`            ${style.colour}${paint.bold}${style.label}${paint.reset}  ${order}`);
  for (const chunk of wrap(reason, 62)) {
    line(`            ${paint.dim}${chunk}${paint.reset}`);
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) {
      lines.push(current.trim());
      current = word;
    } else {
      current += ' ' + word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

/* ------------------------------------------------------------------- main - */

async function main(): Promise<void> {
  if (useAgent && !agentAvailable()) {
    console.error(
      `\n${paint.red}--agent needs AGENT_API_KEY in .env.${paint.reset}\n` +
        `Get a free key at ${paint.bold}console.groq.com${paint.reset} (no card required).\n` +
        `Run ${paint.bold}npm run demo${paint.reset} instead - every policy decision is identical, ` +
        `there is just no model in front of it.\n`,
    );
    process.exit(1);
  }

  // A fresh database, so the numbers printed below are honest.
  const dbPath = resolve(env.auditDbPath);
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(dbPath + suffix, { force: true });
  }

  const mandate = loadMandate(env.policyPath);
  const store = new AuditStore(dbPath);

  // Count what actually reaches the payment rail. The claim "a blocked purchase
  // makes zero Razorpay calls" should be a measurement, not a promise.
  let railCalls = 0;
  const countingRail: PaymentRail = async (intent) => {
    railCalls += 1;
    return createOrder(intent);
  };

  const gate = new Gatekeeper({ mandate, store, createOrder: countingRail });
  const { scope } = mandate;

  line('');
  line(`${paint.bold}UPI Agent Trust Layer${paint.reset} ${paint.grey}- four scenarios, fresh database${paint.reset}`);
  rule();
  line(`  rail      ${modeLabel()}`);
  line(`  driver    ${useAgent ? `LLM agent (${env.agentModel})` : 'direct - no LLM in the loop'}`);
  line(`  mandate   ${mandate.mandate_id}, ${formatInr(scope.per_transaction_cap_inr)}/purchase, ` +
       `${formatInr(scope.monthly_cap_inr)}/month, approval over ${formatInr(scope.step_up_threshold_inr)}`);
  line(`  blocked   ${scope.category_deny.join(', ')}`);
  rule();

  /* -- 1: an ordinary purchase, inside every limit ------------------------ */
  heading(1, 'Everyday purchase, well inside the mandate', 'expect: paid');
  const one = await attempt(
    { item: 'whey protein powder 1kg', amount_inr: 800, category: 'groceries', merchant: 'BigBasket' },
    'Order me a 1kg tub of whey protein powder from BigBasket, it costs about 800 rupees.',
  );

  /* -- 2: the one that matters ------------------------------------------- */
  heading(2, 'Expensive purchase in a blocked category', 'expect: blocked on three rules, zero Razorpay calls');
  const railBefore = railCalls;
  const two = await attempt(
    { item: 'mechanical gaming keyboard', amount_inr: 15_000, category: 'electronics', merchant: 'Amazon' },
    'Buy me the mechanical gaming keyboard I wanted from Amazon, it is 15000 rupees.',
  );
  line(`            ${paint.bold}${two.violations} rules broken${paint.reset}${paint.grey}, all reported at once${paint.reset}`);
  line(
    `            ${railCalls === railBefore ? paint.green + '✓' : paint.red + '✗'} ` +
      `Razorpay calls during this scenario: ${railCalls - railBefore}${paint.reset}`,
  );

  /* -- 3: the agent recovers --------------------------------------------- */
  heading(3, 'A compliant alternative after the block', 'expect: paid, and linked to the block it followed');
  const three = await attempt(
    { item: 'adjustable phone stand', amount_inr: 1200, category: 'accessories', merchant: 'Amazon' },
    'That was blocked. Suggest one cheaper alternative that the mandate allows, and buy it.',
  );
  if (three.retryOf) {
    line(`            ${paint.blue}↩ logged as a retry of ${three.retryOf}${paint.reset}`);
  }

  /* -- 4: a human in the loop -------------------------------------------- */
  heading(4, 'Large purchase needing human approval', 'expect: parked, then paid only after a person approves');
  const four = await attempt(
    { item: 'annual music subscription', amount_inr: 1800, category: 'subscriptions', merchant: 'Spotify' },
    'Renew my annual music subscription on Spotify, it is 1800 rupees.',
  );

  const parked = store.pendingStepUps(mandate.mandate_id)[0];
  if (parked) {
    line(`            ${paint.grey}...a person clicks Approve in the dashboard...${paint.reset}`);
    const resolved = await gate.resolveStepUp(parked.event_id, true);
    verdict(resolved.decision, resolved.event.reason, resolved.order_id, resolved.event.razorpay_mock);
    line(`            ${paint.grey}policy was re-evaluated at approval time, not at request time${paint.reset}`);
  }

  /* -- summary ------------------------------------------------------------ */
  const events = store.list(1000);
  const spent = store.monthSpendInr(mandate.mandate_id, new Date());
  const blocked = events.filter((e) => e.decision === 'blocked');
  const blockedValue = blocked.reduce((sum, e) => sum + e.amount_inr, 0);

  line('');
  rule();
  line(`${paint.bold}  Summary${paint.reset}`);
  line(`  decisions logged        ${events.length}`);
  line(
    `  money actually spent    ${paint.green}${formatInr(spent)}${paint.reset} of the ` +
      `${formatInr(scope.monthly_cap_inr)} monthly cap ` +
      `${paint.grey}(${formatInr(scope.monthly_cap_inr - spent)} left)${paint.reset}`,
  );
  line(
    `  money stopped by policy ${paint.red}${formatInr(blockedValue)}${paint.reset} ` +
      `${paint.grey}across ${blocked.length} blocked attempt${blocked.length === 1 ? '' : 's'}${paint.reset}`,
  );
  line(`  Razorpay calls made     ${railCalls} ${paint.grey}- one per purchase that policy allowed, none for the block${paint.reset}`);
  rule();
  line(`  audit trail  ${paint.grey}${dbPath}${paint.reset}`);
  line(`  dashboard    ${paint.grey}npm start  ->  http://localhost:${env.port}${paint.reset}`);
  line('');

  store.close();

  // Referenced so the compiler keeps them meaningful in both modes.
  void one;
  void four;

  /* ---------------------------------------------------------------------- */

  interface Attempted {
    violations: number;
    retryOf: string | null;
  }

  async function attempt(
    intent: Record<string, unknown>,
    prompt: string,
  ): Promise<Attempted> {
    line(
      `            ${paint.bold}${formatInr(intent.amount_inr as number)}${paint.reset} ` +
        `${intent.item} ${paint.grey}· ${intent.category}${paint.reset}`,
    );

    if (!useAgent) {
      const outcome = await gate.attemptPurchase(intent);
      verdict(outcome.decision, outcome.event.reason, outcome.order_id, outcome.event.razorpay_mock);
      return {
        violations: outcome.event.violations.length,
        retryOf: outcome.event.retry_of_event_id,
      };
    }

    line(`            ${paint.grey}user: "${prompt}"${paint.reset}`);
    const run = await runShoppingAgent(prompt, gate);
    const last = run.events[run.events.length - 1];
    if (last) {
      verdict(last.decision, last.reason, last.razorpay_order_id, last.razorpay_mock);
    } else {
      line(`            ${paint.grey}the agent made no purchase attempt${paint.reset}`);
    }
    for (const chunk of wrap(`agent: ${run.reply}`, 62)) {
      line(`            ${paint.blue}${chunk}${paint.reset}`);
    }
    return {
      violations: last ? last.violations.length : 0,
      retryOf: last ? last.retry_of_event_id : null,
    };
  }
}

main().catch((err: unknown) => {
  console.error(`\n${paint.red}The demo stopped:${paint.reset} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
