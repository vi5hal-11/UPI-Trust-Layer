/**
 * The append-only audit trail.
 *
 * Every decision the gatekeeper reaches is written here, allowed or not. There
 * is deliberately no method on this class that updates or deletes an event, and
 * the database refuses both with a trigger, so "append-only" is enforced rather
 * than merely intended. A resolution is a new row pointing back at the row it
 * resolves.
 */
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  SPENDING_DECISIONS,
  type AuditEvent,
  type AuditEventInput,
  type Budget,
  type Violation,
} from '../types.js';

/** Months are bucketed in IST - it is the month boundary an Indian user means. */
const IST = 'Asia/Kolkata';

/** The YYYY-MM bucket a moment falls into, in IST. */
export function monthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '00';
  return `${year}-${month}`;
}

/** Shape of a row as SQLite hands it back. */
interface Row {
  event_id: string;
  timestamp: string;
  mandate_id: string;
  decision: string;
  item: string;
  amount_inr: number;
  category: string;
  merchant: string | null;
  reason: string;
  violations: string;
  budget: string | null;
  razorpay_order_id: string | null;
  razorpay_mock: number;
  actor: string;
  retry_of_event_id: string | null;
  resolves_event_id: string | null;
}

const SPEND_PLACEHOLDERS = SPENDING_DECISIONS.map(() => '?').join(', ');

export class AuditStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        seq               INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id          TEXT    NOT NULL UNIQUE,
        timestamp         TEXT    NOT NULL,
        month_key         TEXT    NOT NULL,
        mandate_id        TEXT    NOT NULL,
        decision          TEXT    NOT NULL,
        item              TEXT    NOT NULL,
        amount_inr        REAL    NOT NULL,
        category          TEXT    NOT NULL,
        merchant          TEXT,
        reason            TEXT    NOT NULL,
        violations        TEXT    NOT NULL,
        budget            TEXT,
        razorpay_order_id TEXT,
        razorpay_mock     INTEGER NOT NULL,
        actor             TEXT    NOT NULL,
        retry_of_event_id TEXT,
        resolves_event_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_spend
        ON audit_events (mandate_id, month_key, decision);
      CREATE INDEX IF NOT EXISTS idx_audit_resolves
        ON audit_events (resolves_event_id);

      -- An audit trail that can be rewritten is not an audit trail. These make
      -- the claim true at the storage layer, not just in the class API above.
      CREATE TRIGGER IF NOT EXISTS audit_events_no_update
        BEFORE UPDATE ON audit_events
        BEGIN
          SELECT RAISE(ABORT, 'audit_events is append-only: rows cannot be updated');
        END;

      CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
        BEFORE DELETE ON audit_events
        BEGIN
          SELECT RAISE(ABORT, 'audit_events is append-only: rows cannot be deleted');
        END;
    `);
  }

  /** Write one decision. Returns the stored event, id and timestamp stamped. */
  append(input: AuditEventInput): AuditEvent {
    const now = new Date();
    const stored: AuditEvent = {
      ...input,
      event_id: `evt_${randomBytes(6).toString('hex')}`,
      timestamp: now.toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO audit_events (
           event_id, timestamp, month_key, mandate_id, decision, item, amount_inr,
           category, merchant, reason, violations, budget, razorpay_order_id,
           razorpay_mock, actor, retry_of_event_id, resolves_event_id
         ) VALUES (
           @event_id, @timestamp, @month_key, @mandate_id, @decision, @item, @amount_inr,
           @category, @merchant, @reason, @violations, @budget, @razorpay_order_id,
           @razorpay_mock, @actor, @retry_of_event_id, @resolves_event_id
         )`,
      )
      .run({
        event_id: stored.event_id,
        timestamp: stored.timestamp,
        month_key: monthKey(now),
        mandate_id: stored.mandate_id,
        decision: stored.decision,
        item: stored.item,
        amount_inr: stored.amount_inr,
        category: stored.category,
        merchant: stored.merchant,
        reason: stored.reason,
        violations: JSON.stringify(stored.violations),
        budget: stored.budget === null ? null : JSON.stringify(stored.budget),
        razorpay_order_id: stored.razorpay_order_id,
        razorpay_mock: stored.razorpay_mock ? 1 : 0,
        actor: stored.actor,
        retry_of_event_id: stored.retry_of_event_id,
        resolves_event_id: stored.resolves_event_id,
      });

    return stored;
  }

  /** Newest first. Ordered by insertion sequence, so same-millisecond writes
   *  still come back in the order they happened. */
  list(limit = 100): AuditEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_events ORDER BY seq DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map(toEvent);
  }

  get(eventId: string): AuditEvent | null {
    const row = this.db
      .prepare('SELECT * FROM audit_events WHERE event_id = ?')
      .get(eventId) as Row | undefined;
    return row ? toEvent(row) : null;
  }

  /** Parked step-ups that no later event has resolved. Oldest first - a queue. */
  pendingStepUps(mandateId: string): AuditEvent[] {
    const rows = this.db
      .prepare(
        `SELECT parked.* FROM audit_events AS parked
          WHERE parked.mandate_id = ?
            AND parked.decision = 'step_up_required'
            AND NOT EXISTS (
              SELECT 1 FROM audit_events AS resolution
               WHERE resolution.resolves_event_id = parked.event_id
            )
          ORDER BY parked.seq ASC`,
      )
      .all(mandateId) as Row[];
    return rows.map(toEvent);
  }

  /**
   * Money that actually moved this month, for this mandate.
   *
   * Only `allowed` and `step_up_approved` count. A blocked attempt, a parked
   * step-up, a denied one, and a payment that failed on the rail all moved no
   * money, so none of them may consume the budget.
   */
  monthSpendInr(mandateId: string, now: Date): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount_inr), 0) AS total
           FROM audit_events
          WHERE mandate_id = ?
            AND month_key = ?
            AND decision IN (${SPEND_PLACEHOLDERS})`,
      )
      .get(mandateId, monthKey(now), ...SPENDING_DECISIONS) as { total: number };
    return Math.round(row.total * 100) / 100;
  }

  close(): void {
    this.db.close();
  }
}

function toEvent(row: Row): AuditEvent {
  return {
    event_id: row.event_id,
    timestamp: row.timestamp,
    mandate_id: row.mandate_id,
    decision: row.decision as AuditEvent['decision'],
    item: row.item,
    amount_inr: row.amount_inr,
    category: row.category,
    merchant: row.merchant,
    reason: row.reason,
    violations: JSON.parse(row.violations) as Violation[],
    budget: row.budget === null ? null : (JSON.parse(row.budget) as Budget),
    razorpay_order_id: row.razorpay_order_id,
    razorpay_mock: row.razorpay_mock === 1,
    actor: row.actor as AuditEvent['actor'],
    retry_of_event_id: row.retry_of_event_id,
    resolves_event_id: row.resolves_event_id,
  };
}
