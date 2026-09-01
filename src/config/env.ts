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

export const env = {
  razorpayKeyId: str('RAZORPAY_KEY_ID'),
  razorpayKeySecret: str('RAZORPAY_KEY_SECRET'),
  anthropicApiKey: str('ANTHROPIC_API_KEY'),
  agentModel: str('AGENT_MODEL', 'claude-sonnet-4-5'),
  port: Number.parseInt(str('PORT', '3000'), 10) || 3000,
  auditDbPath: str('AUDIT_DB_PATH', 'data/audit.db'),
  policyPath: str('POLICY_PATH', 'src/config/policy.default.json'),
} as const;
