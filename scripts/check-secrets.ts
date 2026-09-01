/**
 * Pre-push / pre-submit secret scan.
 *
 * The naive grep everyone writes - `git log -p | grep rzp_` - matches the
 * `rzp_test_` prefix constant in the Razorpay client, the placeholders in
 * .env.example, and the deliberately fake key in the isolation test. A check
 * that always fires is a check you stop reading, so this one looks for the
 * SHAPE of a real credential and ignores anything marked as an example.
 *
 *   npm run check:secrets
 */
import { execSync } from 'node:child_process';

/** Real Razorpay ids are the prefix plus ~14 alphanumerics with mixed case. */
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Razorpay key id', re: /\brzp_(?:test|live)_[A-Za-z0-9]{10,}\b/g },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'assigned key secret', re: /key_secret\s*[:=]\s*['"][A-Za-z0-9]{12,}['"]/g },
];

/** Anything carrying one of these is a placeholder, not a credential. */
const PLACEHOLDER = /EXAMPLE|PLACEHOLDER|YOUR_|xxxx|<.*>|NotAReal|not_a_real/i;

const history = execSync('git log -p --no-color', {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});

const hits: string[] = [];
for (const { name, re } of PATTERNS) {
  for (const match of history.matchAll(re)) {
    if (PLACEHOLDER.test(match[0])) continue;
    hits.push(`${name}: ${match[0].slice(0, 20)}...`);
  }
}

if (hits.length > 0) {
  console.error('\n  SECRET FOUND IN GIT HISTORY - do not push.\n');
  for (const hit of [...new Set(hits)]) console.error(`    ${hit}`);
  console.error(
    '\n  Rotate the key in the Razorpay/Anthropic dashboard first. Rewriting\n' +
      '  history is secondary - the leaked key is the problem.\n',
  );
  process.exit(1);
}

console.log('  No credentials in git history. Placeholders and prefix constants ignored.');
