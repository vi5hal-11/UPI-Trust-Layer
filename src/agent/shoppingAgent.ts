/**
 * The shopping agent: a tool-use loop with exactly one tool.
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
 * The provider is deliberately not fixed. Any OpenAI-compatible endpoint works
 * (Groq, Cerebras, OpenAI, a local Ollama), configured by AGENT_BASE_URL and
 * AGENT_MODEL. That is not a convenience feature - it is the thesis stated in
 * code. If swapping a frontier model for a free open-weights one changed which
 * purchases were allowed, the boundary would be in the prompt, and this project
 * would be wrong. It does not, because the boundary is a pure function.
 *
 * The loop is written by hand rather than using an agent framework because the
 * turn cap and the per-call audit capture are the point, and a loop a judge can
 * read in thirty seconds is worth more here than one less file.
 */
import OpenAI from 'openai';
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
 * Deliberately not `strict`. The schema is a hint to the model, not a security
 * control - everything it sends is re-validated with zod inside the gatekeeper
 * before it can reach a decision. A schema the model fills in is exactly as
 * trustworthy as the model.
 */
const ATTEMPT_PURCHASE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'attempt_purchase',
    description:
      'Ask the policy gatekeeper to buy one item. The gatekeeper checks it against the ' +
      'spending mandate and either pays, blocks it, or parks it for human approval. ' +
      'Returns the decision, a plain-English reason, and whether money actually moved. ' +
      'This is the only way you can spend anything.',
    parameters: {
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
  return Boolean(env.agentApiKey);
}

export async function runShoppingAgent(
  userMessage: string,
  gatekeeper: Gatekeeper,
): Promise<AgentRun> {
  if (!agentAvailable()) {
    throw new Error(
      'AGENT_API_KEY is not set, so the LLM agent cannot run. Use direct mode ' +
        '(`npm run demo`, or POST /api/intent) - every policy decision is identical, ' +
        'there is just no model in front of it.',
    );
  }

  const client = new OpenAI({ apiKey: env.agentApiKey, baseURL: env.agentBaseUrl });
  const model = env.agentModel;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];
  const events: AuditEvent[] = [];
  const toolCalls: ToolCallRecord[] = [];
  let reply = '';
  let turns = 0;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    turns = turn + 1;

    const response = await client.chat.completions
      .create({
        model,
        max_tokens: 2048,
        messages,
        tools: [ATTEMPT_PURCHASE_TOOL],
      })
      .catch((err: unknown) => {
        throw describeProviderFailure(err, model);
      });

    const choice = response.choices[0];
    if (!choice) break;

    const message = choice.message;
    if (message.content?.trim()) reply = message.content.trim();

    // The assistant turn has to survive the round trip verbatim, tool calls
    // included, or the model loses track of what it already asked for.
    messages.push(message);

    const requested = message.tool_calls ?? [];
    if (requested.length === 0) break;

    for (const call of requested) {
      if (call.type !== 'function') continue;

      if (call.function.name !== 'attempt_purchase') {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `There is no tool called "${call.function.name}". The only tool you have is attempt_purchase.`,
        });
        continue;
      }

      // Whatever the model produced. It goes to the gatekeeper as unknown and
      // is validated there - never trusted here. Malformed JSON is a blocked
      // decision like any other, not a crash.
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        input = { _malformed_arguments: call.function.arguments };
      }

      const outcome = await gatekeeper.attemptPurchase(input, { actor: 'agent' });
      events.push(outcome.event);
      toolCalls.push({
        input,
        decision: outcome.decision,
        paid: outcome.paid,
        event_id: outcome.event.event_id,
      });

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({
          decision: outcome.decision,
          paid: outcome.paid,
          razorpay_order_id: outcome.order_id,
          message: outcome.agent_message,
          event_id: outcome.event.event_id,
        }),
      });
    }
  }

  if (!reply) {
    reply =
      `I stopped after ${turns} turns without a final answer. Check the decision log ` +
      `for what was actually attempted.`;
  }

  return { reply, events, tool_calls: toolCalls, turns, model };
}

/** Say which model failed and what to do - a bare 404 body helps nobody. */
function describeProviderFailure(err: unknown, model: string): Error {
  if (err instanceof OpenAI.NotFoundError) {
    return new Error(
      `The model "${model}" was not found at ${env.agentBaseUrl}. Check the model id your ` +
        `provider offers and set AGENT_MODEL in .env to one your key can use.`,
    );
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return new Error(
      `AGENT_API_KEY was rejected by ${env.agentBaseUrl}. Check the key in .env, or clear it ` +
        `and run in direct mode - the policy decisions are the same either way.`,
    );
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new Error(
      `Rate limited while running model "${model}". Wait and retry, or run the demo in ` +
        `direct mode.`,
    );
  }
  if (err instanceof OpenAI.APIError) {
    return new Error(`Provider error ${err.status} calling model "${model}": ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
