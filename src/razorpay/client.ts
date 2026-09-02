/**
 * The payment rail. This is the ONLY module in the repo that imports the
 * Razorpay SDK, and nothing the model produces can reach it except as an
 * already-approved decision handed over by the gatekeeper.
 *
 * There is no stubbed path here. Every order in this module is a real order
 * created against Razorpay's TEST mode, so what the audit trail records is
 * what Razorpay actually did.
 *
 * TEST MODE ONLY, permanently. This service demonstrates an autonomous agent
 * spending money; a public deployment of it must not be capable of moving real
 * money, whatever is in the environment. A key that is not a test key is
 * refused at startup and there is no flag to override that.
 *
 * Tests do not stub this module. The Gatekeeper takes its payment rail as a
 * constructor argument, so a test injects a fake rail rather than relying on
 * production code carrying a mock branch.
 */
import Razorpay from 'razorpay';
import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import type { PurchaseIntent, RazorpayAction } from '../types.js';

const TEST_KEY_PREFIX = 'rzp_test_';

/**
 * CLAUDE.md invariant 8. Runs at import time, which is startup, because an
 * agent that can spend real money is the one failure this project exists to
 * prevent. Credentials are required: there is no keyless path.
 */
function assertTestModeOnly(): void {
  const keyId = env.razorpayKeyId;

  if (!keyId) {
    throw new Error(
      `Refusing to start: RAZORPAY_KEY_ID is not set.\n\n` +
        `  This service creates real orders against Razorpay's test mode and has no\n` +
        `  stubbed fallback, so it cannot start without credentials.\n\n` +
        `  1. Copy .env.example to .env\n` +
        `  2. Razorpay Dashboard -> switch to Test Mode -> Account & Settings -> API Keys\n` +
        `  3. Put the test key id and secret in .env\n\n` +
        `  Test-mode keys only. A key that does not begin with "${TEST_KEY_PREFIX}" is refused.`,
    );
  }

  if (!keyId.startsWith(TEST_KEY_PREFIX)) {
    throw new Error(
      `Refusing to start: RAZORPAY_KEY_ID must be a test-mode key beginning with ` +
        `"${TEST_KEY_PREFIX}", but it starts with "${keyId.slice(0, 8)}...". This project ` +
        `never talks to a live payment rail. Turn on the Test Mode toggle in the Razorpay ` +
        `dashboard and generate a test key.`,
    );
  }

  if (!env.razorpayKeySecret) {
    throw new Error(
      `Refusing to start: RAZORPAY_KEY_ID is set but RAZORPAY_KEY_SECRET is empty. ` +
        `Both are required.`,
    );
  }
}

assertTestModeOnly();

/**
 * Always true once this module has loaded: startup fails without credentials,
 * so there is no configuration in which orders are not real.
 *
 * Kept as a function rather than inlined so the API response shape and the
 * dashboard badge continue to read from one place.
 */
export function isLiveMode(): boolean {
  return true;
}

/** What to print on the dashboard badge and in the boot banner. */
export function modeLabel(): string {
  return 'Razorpay test mode - real orders, no real money';
}

let client: Razorpay | null = null;

function getClient(): Razorpay {
  if (!client) {
    client = new Razorpay({
      key_id: env.razorpayKeyId,
      key_secret: env.razorpayKeySecret,
    });
  }
  return client;
}

/** Receipts are capped at 40 characters by the Razorpay API. */
function newReceipt(): string {
  return `uatl_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
}

/**
 * Create an order for a purchase the gatekeeper has already approved.
 *
 * Throws on a rail failure rather than returning something falsy - the caller
 * logs that as `payment_failed`, which is its own decision and never reads as a
 * successful purchase.
 */
export async function createOrder(intent: PurchaseIntent): Promise<RazorpayAction> {
  const amountPaise = Math.round(intent.amount_inr * 100);
  const receipt = newReceipt();

  try {
    const order = await getClient().orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        item: intent.item,
        category: intent.category,
        merchant: intent.merchant ?? 'unspecified',
        // So the merchant, and anyone reading the dashboard later, can see this
        // was an agent rather than a person tapping a phone.
        initiated_by: 'ai_agent',
        approved_by: 'upi-agent-trust-layer policy engine',
      },
    });

    return {
      mock: false,
      order_id: String(order.id),
      amount_paise: Number(order.amount),
      currency: String(order.currency),
      status: String(order.status),
      receipt: order.receipt ? String(order.receipt) : null,
      created_at_unix: Number(order.created_at),
    };
  } catch (err) {
    throw new Error(`Razorpay rejected the order: ${describeRazorpayError(err)}`);
  }
}

/** Razorpay errors nest the useful part; a bare [object Object] helps nobody. */
function describeRazorpayError(err: unknown): string {
  if (err && typeof err === 'object' && 'error' in err) {
    const inner = (err as { error?: { description?: string; code?: string } }).error;
    if (inner?.description) {
      return inner.code ? `${inner.description} (${inner.code})` : inner.description;
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
