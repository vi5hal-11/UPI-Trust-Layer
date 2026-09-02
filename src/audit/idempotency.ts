/**
 * Idempotency for purchase attempts.
 *
 * An agent retries. A network blip, a timeout, a restarted tool loop - and the
 * same purchase arrives twice. Without a key, the second attempt is a second
 * real Razorpay order and the mandate holder is charged twice for one intent.
 *
 * The client sends `Idempotency-Key` on POST /api/intent. The first request
 * with a given key does the work and the result is recorded against that key;
 * every later request with the same key returns the original decision without
 * touching the policy engine or the payment rail again.
 *
 * A key replayed with a *different* body is rejected rather than silently
 * answered, because that means a bug on the caller's side and quietly
 * returning the wrong purchase's outcome would be worse than an error.
 */
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface IdempotencyHit {
  event_id: string;
  response_json: string;
}

export class IdempotencyStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key           TEXT PRIMARY KEY,
        request_hash  TEXT NOT NULL,
        event_id      TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
    `);
  }

  /** Stable across key order, so a re-serialised body is still the same body. */
  static hashRequest(body: unknown): string {
    return createHash('sha256').update(stableStringify(body)).digest('hex');
  }

  /**
   * Returns the stored response when this exact request has been seen before.
   * Throws when the key was used for a different request.
   */
  lookup(key: string, requestHash: string): IdempotencyHit | null {
    const row = this.db
      .prepare(`SELECT request_hash, event_id, response_json FROM idempotency_keys WHERE key = ?`)
      .get(key) as { request_hash: string; event_id: string; response_json: string } | undefined;

    if (!row) return null;

    if (row.request_hash !== requestHash) {
      throw new IdempotencyConflict(
        `Idempotency-Key "${key}" was already used for a different purchase. ` +
          `Reusing a key with changed details is always a caller bug, so this ` +
          `request was not processed. Send a new key.`,
      );
    }

    return { event_id: row.event_id, response_json: row.response_json };
  }

  record(key: string, requestHash: string, eventId: string, response: unknown): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO idempotency_keys
           (key, request_hash, event_id, response_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(key, requestHash, eventId, JSON.stringify(response), new Date().toISOString());
  }
}

export class IdempotencyConflict extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflict';
  }
}

/** JSON.stringify with sorted keys, so {a,b} and {b,a} hash identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
