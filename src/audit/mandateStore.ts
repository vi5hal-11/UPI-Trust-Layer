/**
 * Mandates as data, not as a file on disk.
 *
 * The mandate used to be read from src/config/policy.default.json at boot,
 * which meant the spending limits were effectively hardcoded: changing them
 * required editing a file and restarting. They are now rows, created and
 * revoked at runtime, and that JSON file is only a first-run seed.
 *
 * Two properties are carried over deliberately:
 *
 *   Append-only. A mandate is never edited. Changing the limits issues a NEW
 *   mandate that supersedes the old one, and the old row stays exactly as it
 *   was - because an audit event points at the mandate_id that authorised it,
 *   and rewriting that mandate would falsify the record of every decision made
 *   under it.
 *
 *   Tamper-evident. The integrity hash is recomputed on write and verified on
 *   read, so widening a mandate by editing the database directly is detected
 *   the same way editing the file was.
 */
import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { computeIntegrityHash } from '../gatekeeper/mandate.js';
import { MandateSchema, type Mandate, type MandateScope } from '../types.js';

/**
 * Random, not time-derived. A millisecond timestamp collides when two mandates
 * are issued in the same tick - which a test caught, and which would have
 * surfaced in production as a UNIQUE constraint failure at exactly the moment
 * someone was trying to tighten a spending limit.
 */
function newMandateId(): string {
  return `mandate_${randomBytes(6).toString('hex')}`;
}

interface MandateRow {
  mandate_id: string;
  principal: string;
  scope_json: string;
  issued_at: string;
  expires_at: string;
  integrity_hash: string;
  revoked_at: string | null;
}

export class MandateStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mandates (
        seq            INTEGER PRIMARY KEY AUTOINCREMENT,
        mandate_id     TEXT    NOT NULL UNIQUE,
        principal      TEXT    NOT NULL,
        scope_json     TEXT    NOT NULL,
        issued_at      TEXT    NOT NULL,
        expires_at     TEXT    NOT NULL,
        integrity_hash TEXT    NOT NULL,
        revoked_at     TEXT,
        created_at     TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mandates_active
        ON mandates (revoked_at, seq DESC);

      -- A mandate is never edited, only superseded or revoked. The one
      -- permitted update is stamping revoked_at, and only from NULL: a
      -- revocation cannot itself be undone or rewritten.
      CREATE TRIGGER IF NOT EXISTS mandates_append_only
        BEFORE UPDATE ON mandates
        WHEN OLD.revoked_at IS NOT NULL
          OR NEW.mandate_id     <> OLD.mandate_id
          OR NEW.principal      <> OLD.principal
          OR NEW.scope_json     <> OLD.scope_json
          OR NEW.issued_at      <> OLD.issued_at
          OR NEW.expires_at     <> OLD.expires_at
          OR NEW.integrity_hash <> OLD.integrity_hash
        BEGIN
          SELECT RAISE(ABORT,
            'mandates are append-only: issue a new mandate instead of editing one');
        END;

      CREATE TRIGGER IF NOT EXISTS mandates_no_delete
        BEFORE DELETE ON mandates
        BEGIN
          SELECT RAISE(ABORT,
            'mandates cannot be deleted: audit events reference the mandate that authorised them');
        END;
    `);
  }

  private static toMandate(row: MandateRow): Mandate {
    const parsed = MandateSchema.safeParse({
      mandate_id: row.mandate_id,
      principal: row.principal,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      integrity_hash: row.integrity_hash,
      scope: JSON.parse(row.scope_json),
    });

    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(
        `Mandate "${row.mandate_id}" in the database is not a valid mandate — ${detail}. ` +
          `It was not used. Issue a new mandate rather than editing this row.`,
      );
    }
    return parsed.data;
  }

  /** The mandate currently in force: the newest that has not been revoked. */
  active(): Mandate | null {
    const row = this.db
      .prepare(
        `SELECT mandate_id, principal, scope_json, issued_at, expires_at, integrity_hash, revoked_at
           FROM mandates WHERE revoked_at IS NULL ORDER BY seq DESC LIMIT 1`,
      )
      .get() as MandateRow | undefined;
    return row ? MandateStore.toMandate(row) : null;
  }

  list(limit = 50): Array<Mandate & { revoked_at: string | null }> {
    const rows = this.db
      .prepare(
        `SELECT mandate_id, principal, scope_json, issued_at, expires_at, integrity_hash, revoked_at
           FROM mandates ORDER BY seq DESC LIMIT ?`,
      )
      .all(limit) as MandateRow[];
    return rows.map((row) => ({ ...MandateStore.toMandate(row), revoked_at: row.revoked_at }));
  }

  /**
   * Issue a mandate. The hash is computed here rather than accepted from the
   * caller - a caller-supplied hash would let anyone who can reach this API
   * mint a mandate that passes its own integrity check.
   */
  issue(input: {
    principal: string;
    scope: MandateScope;
    expires_at: string;
    mandate_id?: string;
  }): Mandate {
    const now = new Date().toISOString();
    const mandate: Mandate = {
      mandate_id: input.mandate_id ?? newMandateId(),
      principal: input.principal,
      issued_at: now,
      expires_at: input.expires_at,
      scope: input.scope,
      integrity_hash: computeIntegrityHash(input.principal, input.scope),
    };

    this.db
      .prepare(
        `INSERT INTO mandates
           (mandate_id, principal, scope_json, issued_at, expires_at, integrity_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mandate.mandate_id,
        mandate.principal,
        JSON.stringify(mandate.scope),
        mandate.issued_at,
        mandate.expires_at,
        mandate.integrity_hash,
        now,
      );

    return mandate;
  }

  /** Revoking is the only permitted mutation, and it is one-way. */
  revoke(mandateId: string): boolean {
    const result = this.db
      .prepare(`UPDATE mandates SET revoked_at = ? WHERE mandate_id = ? AND revoked_at IS NULL`)
      .run(new Date().toISOString(), mandateId);
    return result.changes > 0;
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM mandates`).get() as { n: number }).n;
  }

  /**
   * First run only. Puts the seed mandate in the database so a fresh clone has
   * something to demonstrate; after that the database is the source of truth
   * and the seed file is never read again.
   */
  seedIfEmpty(seed: Mandate): Mandate {
    const existing = this.active();
    if (existing) return existing;
    return this.issue({
      mandate_id: seed.mandate_id,
      principal: seed.principal,
      scope: seed.scope,
      expires_at: seed.expires_at,
    });
  }
}
