/**
 * The shopping agent: a Claude tool-use loop with exactly one tool.
 *
 * Note what this module does NOT import. There is no `import` of the Razorpay
 * client anywhere in this file or anything it pulls in at runtime - the
 * Gatekeeper arrives as a type-only import, which TypeScript erases, so the
 * model's code path has no reference to a payment key, an endpoint, or the SDK.
 * Its entire capability surface is `attempt_purchase`.
 *
 * The system prompt below tells the model how to behave. It is NOT what stops
 * it overspending - the gatekeeper does that, deterministically, whatever the
 * model asks for. The prompt exists so a well-behaved model gives a good
 * explanation, not so a badly-behaved one is contained.
 *
 * The loop is written by hand rather than using the SDK's tool runner because
 * the turn cap and the per-call audit capture are the point, and a loop a judge
 * can read in thirty seconds is worth more here than one less file.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import type { Gatekeeper } from '../gatekeeper/service.js';
import type { AuditEvent } from '../types.js';

/** Enough turns for: try, get blocked, propose one alternative, report back. */
const MAX_TURNS = 6;

const SYSTEM_PROMPT = `You are a shopping assistant that can spend a person's money over UPI, within a mandate they set in advance.

You have exactly one tool: attempt_purchase. You cannot pay for anything yourself. Every purchase goes to a policy gatekeeper that decides, deterministically, whether it is allowed. You do not decide, and you cannot appeal.

How to behave:

1. NEVER say or imply that a purchase succeeded unless the tool result you got back has "paid": true. If it says blocked, or waiting for approval, or the payment failed, say exactly that. Reporting a blocked purchase as done is the worst mistake you can make here.

2. If a purchase is BLOCKED, read the reason. If something cheaper, in a category the mandate allows, genuinely meets the same need, propose that ONE alternative and call attempt_purchase once more. If that is also blocked, stop and explain. Never make a third attempt.

3. If a purchase needs HUMAN APPROVAL, stop. Tell the person their approval is waiting in the dashboard. Do not call the tool again for that item.

4. NEVER split a purchase into smaller pieces to get under a cap or an approval threshold. Two payments of 1,500 instead of one of 3,000 is circumvention, it will be caught, and it is a serious breach of trust. If something is over a limit, the answer is that it is over the limit.

5. Do not invent order ids, amounts, or confirmations. Report only what the tool told you.

Be brief and concrete. The person reading you wants to know what happened to their money.`;

/**
 * Deliberately not marked `strict`. The schema is a hint to the model, not a
 * security control - everything it sends is re-validated with zod inside the
 * gatekeeper before it can reach a decision. A schema the model fills in is
 * exactly as trustworthy as the model.
 */
const ATTEMPT_PURCHASE_TOOL: Anthropic.Tool = {
  name: 'attempt_purchase',
  description:
    'Ask the policy gatekeeper to buy one item. The gatekeeper checks it against the ' +
    'spending mandate and either pays, blocks it, or parks it for human approval. ' +
    'Returns the decision, a plain-English reason, and whether money actually moved. ' +
    'This is the only way you can spend anything.',
  input_schema: {
    type: 'object',
    properties: {
      item: {
        type: 'string',
        description: 'What is being bought, e.g. "whey protein powder, 1kg".',
      },
      amount_inr: {
        type: 'number',
        description: 'Total price in Indian rupees. A positive number.',
      },
      category: {
        type: 'string',
        description:
          'Spending category, lowercase, e.g. "groceries", "electronics", "subscriptions".',
      },
      merchant: {
        type: 'string',
        description: 'Optional shop or platform name.',
      },
    },
    required: ['item', 'amount_inr', 'category'],
    additionalProperties: false,
  },
};

export interface ToolCallRecord {
  input: unknown;
  decision: string;
  paid: boolean;
  event_id: string;
}

export interface AgentRun {
  reply: string;
  events: AuditEvent[];
  tool_calls: ToolCallRecord[];
  turns: number;
  model: string;
}

/** Whether a real LLM run is possible. Without a key the demo runs direct. */
export function agentAvailable(): boolean {
  return Boolean(env.anthropicApiKey);
}

export async function runShoppingAgent(
  userMessage: string,
  gatekeeper: Gatekeeper,
): Promise<AgentRun> {
  if (!agentAvailable()) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set, so the LLM agent cannot run. Use direct mode ' +
        '(`npm run demo`, or POST /api/intent) - every policy decision is identical, ' +
        'there is just no model in front of it.',
    );
  }

  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const model = env.agentModel;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  const events: AuditEvent[] = [];
  const toolCalls: ToolCallRecord[] = [];
  let reply = '';
  let turns = 0;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    turns = turn + 1;

    // `thinking` and `output_config.effort` are deliberately omitted: AGENT_MODEL
    // is user-configurable, and those parameters are rejected by older models.
    // Current models run adaptive thinking by default anyway.
    const response = await client.messages
      .create({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [ATTEMPT_PURCHASE_TOOL],
        messages,
      })
      .catch((err: unknown) => {
        throw describeAnthropicFailure(err, model);
      });

    // Append the whole content array, not just the text - thinking blocks and
    // tool_use blocks have to survive the round trip.
    messages.push({ role: 'assistant', content: response.content });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text) reply = text;

    if (response.stop_reason === 'refusal') {
      reply = reply || 'The model declined to continue with this request.';
      break;
    }

    if (response.stop_reason !== 'tool_use') {
      break;
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    // Every tool_result for this turn goes back in ONE user message. Splitting
    // them teaches the model to stop making parallel calls - and a model trying
    // to split a purchase to duck the threshold will emit exactly that shape,
    // which we want to see and have the gatekeeper refuse, one call at a time.
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      if (toolUse.name !== ATTEMPT_PURCHASE_TOOL.name) {
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: `There is no tool called "${toolUse.name}". The only tool you have is attempt_purchase.`,
        });
        continue;
      }

      // toolUse.input is whatever the model produced. It goes to the gatekeeper
      // as unknown and is validated there - never trusted here.
      const outcome = await gatekeeper.attemptPurchase(toolUse.input, { actor: 'agent' });
      events.push(outcome.event);
      toolCalls.push({
        input: toolUse.input,
        decision: outcome.decision,
        paid: outcome.paid,
        event_id: outcome.event.event_id,
      });

      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify({
          decision: outcome.decision,
          paid: outcome.paid,
          razorpay_order_id: outcome.order_id,
          message: outcome.agent_message,
          event_id: outcome.event.event_id,
        }),
      });
    }

    messages.push({ role: 'user', content: results });
  }

  if (!reply) {
    reply =
      `I stopped after ${turns} turns without a final answer. Check the decision log ` +
      `for what was actually attempted.`;
  }

  return { reply, events, tool_calls: toolCalls, turns, model };
}

/** Say which model failed and what to do - a bare 404 body helps nobody. */
function describeAnthropicFailure(err: unknown, model: string): Error {
  if (err instanceof Anthropic.NotFoundError) {
    return new Error(
      `The model "${model}" was not found for this API key. Check the model id at ` +
        `console.anthropic.com and set AGENT_MODEL in .env to one your key can use.`,
    );
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error(
      `ANTHROPIC_API_KEY was rejected. Check the key in .env, or clear it and run in ` +
        `direct mode - the policy decisions are the same either way.`,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error(
      `Rate limited by the Anthropic API while running model "${model}". Wait and retry, ` +
        `or run the demo in direct mode.`,
    );
  }
  if (err instanceof Anthropic.APIError) {
    return new Error(`Anthropic API error ${err.status} calling model "${model}": ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
