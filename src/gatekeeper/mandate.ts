/**
 * The mandate: what this agent is permitted to spend, and proof the permission
 * hasn't been edited since it was issued.
 *
 * AP2-*shaped*, not AP2. A scoped, expiring, tamper-evident grant with a
 * SHA-256 integrity hash standing in for signature verification. It catches a
 * config file edited after issuance. It does NOT prove who issued it — an
 * attacker who can write the file can also recompute the hash. Stated plainly
 * in the README rather than dressed up.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MandateSchema, type Mandate, type MandateScope } from '../types.js';

/**
 * Deterministic JSON: object keys sorted at every depth, so two structurally
 * identical scopes hash the same regardless of the order they were written in.
 * Array order is preserved and therefore significant.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',');
  return `{${body}}`;
}

/** SHA-256 over the canonical JSON of the parts that grant authority. */
export function computeIntegrityHash(principal: string, scope: MandateScope): string {
  return createHash('sha256').update(canonicalJson({ principal, scope })).digest('hex');
}

export function isMandateExpired(mandate: Mandate, now: Date): boolean {
  const expiresAt = Date.parse(mandate.expires_at);
  if (Number.isNaN(expiresAt)) {
    // Unparseable expiry fails closed: an unreadable mandate grants nothing.
    return true;
  }
  return now.getTime() > expiresAt;
}

/**
 * True when the mandate carries a hash that no longer matches its own contents.
 * A mandate with no hash at all is not "tampered" — there is nothing to check.
 * `loadMandate` stamps one in memory, so anything that came off disk has one.
 */
export function isMandateTampered(mandate: Mandate): boolean {
  if (!mandate.integrity_hash) return false;
  return mandate.integrity_hash !== computeIntegrityHash(mandate.principal, mandate.scope);
}

/**
 * Read, validate and normalise the mandate. If the config ships without a hash,
 * one is stamped in memory at load time — the file on disk is never written to.
 */
export function loadMandate(path: string): Mandate {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read the mandate at "${path}": ${(err as Error).message}. ` +
        `Set POLICY_PATH in .env, or restore src/config/policy.default.json.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The mandate at "${path}" is not valid JSON: ${(err as Error).message}`);
  }

  const result = MandateSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`The mandate at "${path}" is not a valid mandate — ${detail}`);
  }

  const mandate = result.data;
  if (!mandate.integrity_hash) {
    return { ...mandate, integrity_hash: computeIntegrityHash(mandate.principal, mandate.scope) };
  }
  return mandate;
}
