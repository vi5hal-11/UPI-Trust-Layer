/**
 * The central claim of this project, asserted rather than described:
 * the LLM never touches Razorpay.
 *
 * The trick used here is that the Razorpay client refuses to load at all when
 * the environment holds a non-test key. So we put a LIVE key in the
 * environment and then import the agent module. If the agent had any runtime
 * path to the payment client - a direct import, or a value import of something
 * that imports it - loading it would throw. It doesn't.
 *
 * The second test proves the first one is not vacuous: the same environment
 * makes the gatekeeper service, which legitimately does own the rail, refuse.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Set before any dynamic import below, so `src/config/env.ts` reads it on load.
process.env.RAZORPAY_KEY_ID = 'rzp_live_EXAMPLE_not_a_real_key';
process.env.RAZORPAY_KEY_SECRET = 'EXAMPLE_secret_not_a_real_key';

describe('the agent is isolated from the payment rail', () => {
  it('loads cleanly even with a live Razorpay key in the environment', async () => {
    const agentModule = await import('../src/agent/shoppingAgent.js');

    expect(agentModule.agentAvailable).toBeTypeOf('function');
    expect(agentModule.runShoppingAgent).toBeTypeOf('function');
  });

  it('is not a vacuous test: the same environment stops the module that does own the rail', async () => {
    await expect(import('../src/gatekeeper/service.js')).rejects.toThrow(/rzp_test_/);
  });

  it('names no payment module anywhere in its source', () => {
    const source = readFileSync(new URL('../src/agent/shoppingAgent.ts', import.meta.url), 'utf8');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line) && !/^\s*import type\b/.test(line));

    expect(importLines.join('\n')).not.toMatch(/razorpay/i);
    expect(source).not.toMatch(/RAZORPAY_KEY/);
  });
});
