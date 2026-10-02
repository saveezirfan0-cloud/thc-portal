import { NOTEWORTHY, autosendVerdict } from './schedule';
import type { AutosendConfig, AutosendFacts, AutosendVerdict, JobKind } from './schedule';

/**
 * One run of the event-documents job (ADR-0074), with its I/O injected so
 * the order of operations is testable without a database or a PDF.
 *
 * For every candidate `event_documents_due()` returns:
 *   1. the TypeScript verdict over the same facts — the route acts only
 *      where it and the SQL verdict BOTH say `due` (a disagreement is
 *      counted and logged, never acted on);
 *   2. claim(event, kind) — the SQL re-checks the verdict under a lock and
 *      takes a lease, so two overlapping runs cannot both draw it;
 *   3. generate — the PDF, stored, recorded as an automatic copy;
 *   4. queue — the D1/D2 email under the event's automatic key, or for
 *      an `allocation_update` (ADR-0084) the D1U email under its copy's key;
 *   5. on any failure, release(event, kind, reason) so the next run retries.
 *
 * Log lines carry event ids, kinds and reasons — never a name or an email.
 */

export interface DueRow {
  event_id: string;
  kind: JobKind;
  verdict: string;
  event_date: string;
  first_start: string | null;
  last_end: string | null;
  cancelled: boolean;
  confirmed: number;
  contacts: number;
  undetermined: number;
  manual_allocation_at: string | null;
  signout_queued_at: string | null;
  auto_queued_at: string | null;
  attempts?: number | null;
  /** ADR-0084, read by the allocation_update rows. */
  allocation_sent_at?: string | null;
  changed?: boolean | null;
}

export function factsOf(row: DueRow): AutosendFacts {
  return {
    kind: row.kind,
    eventDate: row.event_date,
    firstStart: row.first_start,
    lastEnd: row.last_end,
    cancelled: row.cancelled,
    confirmed: Number(row.confirmed) || 0,
    contacts: Number(row.contacts) || 0,
    undetermined: Number(row.undetermined) || 0,
    manualAllocationAt: row.manual_allocation_at,
    signoutQueuedAt: row.signout_queued_at,
    autoQueuedAt: row.auto_queued_at,
    attempts: Number(row.attempts) || 0,
    allocationSentAt: row.allocation_sent_at ?? null,
    changed: row.changed ?? null,
  };
}

export type GenerateOutcome = { ok: true; documentId: string } | { ok: false; message: string };

export interface AutosendDeps {
  now: Date;
  config: AutosendConfig;
  rows: readonly DueRow[];
  claim(eventId: string, kind: JobKind): Promise<boolean>;
  generate(eventId: string, kind: JobKind): Promise<GenerateOutcome>;
  /** `skipped`: the SQL re-checked under its lock and stood down (e.g. manual_sent). */
  queue(documentId: string, kind: JobKind): Promise<{ queued: boolean; skipped?: string | null }>;
  release(eventId: string, kind: JobKind, error: string): Promise<void>;
  /** Stop drawing new PDFs after this; the rest wait for the next run. */
  deadline?: number;
  clock?: () => number;
  log(line: string): void;
}

export interface AutosendCounts {
  candidates: number;
  due: number;
  sent: Record<JobKind, number>;
  /** Every verdict, per kind: the job run's record of why nothing went. */
  verdicts: Record<JobKind, Record<string, number>>;
  disagreements: number;
  notClaimed: number;
  duplicate: number;
  /** Stood down at the last moment: a manager sent it while the PDF was drawn. */
  stoodDown: number;
  failed: number;
  deferred: number;
}

function bump(bag: Record<string, number>, key: string) {
  bag[key] = (bag[key] ?? 0) + 1;
}

export async function runAutosend(deps: AutosendDeps): Promise<AutosendCounts> {
  const clock = deps.clock ?? Date.now;
  const counts: AutosendCounts = {
    candidates: deps.rows.length,
    due: 0,
    sent: { allocation: 0, signout: 0, allocation_update: 0 },
    verdicts: { allocation: {}, signout: {}, allocation_update: {} },
    disagreements: 0,
    notClaimed: 0,
    duplicate: 0,
    stoodDown: 0,
    failed: 0,
    deferred: 0,
  };

  for (const row of deps.rows) {
    const verdict: AutosendVerdict = autosendVerdict(factsOf(row), deps.now, deps.config);
    bump(counts.verdicts[row.kind], verdict);

    if (verdict !== row.verdict) {
      counts.disagreements += 1;
      deps.log(
        `event-documents: ${row.kind} ${row.event_id} — SQL says ${row.verdict}, TypeScript ${verdict}; not sent`,
      );
      continue;
    }
    if (verdict !== 'due') {
      if (NOTEWORTHY.has(verdict))
        deps.log(`event-documents: ${row.kind} ${row.event_id} skipped: ${verdict}`);
      continue;
    }

    counts.due += 1;
    if (deps.deadline !== undefined && clock() > deps.deadline) {
      counts.deferred += 1;
      continue;
    }

    if (!(await deps.claim(row.event_id, row.kind))) {
      counts.notClaimed += 1;
      continue;
    }

    try {
      const drawn = await deps.generate(row.event_id, row.kind);
      if (!drawn.ok) throw new Error(drawn.message);
      const { queued, skipped } = await deps.queue(drawn.documentId, row.kind);
      if (queued) {
        counts.sent[row.kind] += 1;
        deps.log(`event-documents: ${row.kind} ${row.event_id} queued`);
      } else if (skipped) {
        counts.stoodDown += 1;
        deps.log(`event-documents: ${row.kind} ${row.event_id} stood down at queue: ${skipped}`);
      } else {
        counts.duplicate += 1;
        deps.log(`event-documents: ${row.kind} ${row.event_id} already had an automatic email`);
      }
    } catch (cause) {
      const message = (cause instanceof Error ? cause.message : String(cause)).slice(0, 300);
      counts.failed += 1;
      deps.log(`event-documents: ${row.kind} ${row.event_id} failed: ${message}`);
      await deps.release(row.event_id, row.kind, message).catch(() => undefined);
    }
  }
  return counts;
}
