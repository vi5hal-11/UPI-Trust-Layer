/**
 * Environment, read once and in one place.
 *
 * Importing this module loads `.env`, so anything that reads configuration
 * imports this rather than reaching for `process.env` directly. That also means
 * the test-mode key guard in the Razorpay client cannot be defeated by an entry
 * point that forgot to load dotenv before importing it.
 */
import 'dotenv/config';

function str(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined ? fallback : value.trim();
}

const nodeEnv = str('NODE_ENV', 'development');

/**
 * The secret that unlocks step-up approvals. Required: an approval gate with a
 * default password is not a gate. Startup fails loudly rather than shipping a
 * guessable one.
 */
function approvalSecret(): string {
  const value = str('APPROVAL_SECRET');
  if (value.length >= 16) return value;

  throw new Error(
    value.length === 0
      ? `Refusing to start: APPROVAL_SECRET is not set.\n\n` +
        `  This unlocks step-up approvals - the human control on the agent's spending.\n` +
        `  Without it, anyone who can reach this port could approve a purchase.\n\n` +
        `  Generate one:  node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"\n` +
        `  Then put it in .env as APPROVAL_SECRET=...`
      : `Refusing to start: APPROVAL_SECRET is only ${value.length} characters. ` +
        `Use at least 16; it is the only thing standing between a stranger and ` +
        `approving a payment.`,
  );
}

export const env = {
  razorpayKeyId: str('RAZORPAY_KEY_ID'),
  razorpayKeySecret: str('RAZORPAY_KEY_SECRET'),
  /**
   * Any OpenAI-compatible provider. Defaults to Groq because it has a free
   * tier that needs no card, which keeps the agent path runnable by anyone who
   * clones this. ANTHROPIC_API_KEY is still read as a fallback so an existing
   * .env keeps working.
   */
  agentApiKey: str('AGENT_API_KEY') || str('GROQ_API_KEY') || str('ANTHROPIC_API_KEY'),
  agentBaseUrl: str('AGENT_BASE_URL', 'https://api.groq.com/openai/v1'),
  agentModel: str('AGENT_MODEL', 'llama-3.3-70b-versatile'),
  port: Number.parseInt(str('PORT', '3000'), 10) || 3000,
  auditDbPath: str('AUDIT_DB_PATH', 'data/audit.db'),
  policyPath: str('POLICY_PATH', 'src/config/policy.default.json'),
  nodeEnv,
  isProduction: nodeEnv === 'production',

  /**
   * Run the four demo scenarios through the real gatekeeper on boot when the
   * audit trail is empty. Intended for hosted demos on ephemeral storage, where
   * a restart would otherwise leave a visitor looking at an empty log.
   */
  seedDemoOnEmpty: str('SEED_DEMO_ON_EMPTY', 'false').toLowerCase() === 'true',

  /**
   * Lazy on purpose. The policy engine, the audit store and their tests have
   * no business needing an approval secret, and importing this module must not
   * force one to exist. It is validated the first time the auth layer asks.
   */
  get approvalSecret(): string {
    return approvalSecret();
  },
} as const;
