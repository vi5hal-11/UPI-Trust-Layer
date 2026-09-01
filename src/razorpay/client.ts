/**
 * The payment rail. This is the ONLY module in the repo that imports the
 * Razorpay SDK, and nothing the model produces can reach it except as an
 * already-approved decision handed over by the gatekeeper.
 *
 * Two modes:
 *   MOCK - no keys configured. Every policy decision is still real and still
 *          logged; only this last call is stubbed, and the stub says so in the
 *          order id itself (order_MOCK_...).
 *   LIVE - keys configured. Real orders against Razorpay's TEST mode.
 *
 * "Live" here means really calling Razorpay, never real money: a key that is
 * not a test key is refused at startup.
 */
import Razorpay from 'razorpay';
import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import type { PurchaseIntent, RazorpayAction } from '../types.js';

const TEST_KEY_PREFIX = 'rzp_test_';

/**
 * CLAUDE.md invariant 8. Runs at import time, which is startup, because an
 * agent that can spend real money is the one failure this project exists to
 * prevent. Blank keys are fine - that is mock mode.
 */
function assertTestModeOnly(): void {
  const keyId = env.razorpayKeyId;
  if (!keyId) return;

  if (!keyId.startsWith(TEST_KEY_PREFIX)) {
    throw new Error(
      `Refusing to start: RAZORPAY_KEY_ID must be a test-mode key beginning with ` +
        `"${TEST_KEY_PREFIX}", but it starts with "${keyId.slice(0, 8)}...". This project ` +
        `never talks to a live payment rail. Turn on the Test Mode toggle in the Razorpay ` +
        `dashboard and generate a test key, or leave both Razorpay variables blank to run ` +
        `in mock mode.`,
    );
  }

  if (!env.razorpayKeySecret) {
    throw new Error(
      `Refusing to start: RAZORPAY_KEY_ID is set but RAZORPAY_KEY_SECRET is empty. ` +
        `Set both, or clear both to run in mock mode.`,
    );
  }
}

assertTestModeOnly();

/** True when real Razorpay test-mode orders will be created. */
export function isLiveMode(): boolean {
  return Boolean(env.razorpayKeyId && env.razorpayKeySecret);
}

/** What to print on the dashboard badge and in the boot banner. */
export function modeLabel(): string {
  return isLiveMode()
    ? 'LIVE - creating real orders against Razorpay test mode'
    : 'MOCK - no Razorpay keys set, payment call stubbed';
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

  if (!isLiveMode()) {
    return {
      mock: true,
      order_id: `order_MOCK_${randomBytes(7).toString('hex')}`,
      amount_paise: amountPaise,
      currency: 'INR',
      status: 'created',
      receipt,
      created_at_unix: Math.floor(Date.now() / 1000),
    };
  }

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
