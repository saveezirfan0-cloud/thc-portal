import { describe, expect, it } from 'vitest';
import { runAutosend } from '../run';
import type { AutosendDeps, DueRow } from '../run';
import { parseAutosendConfig } from '../schedule';
import type { DocumentKind } from '../schedule';

const CONFIG = parseAutosendConfig({});
const NOW = new Date('2026-07-10T13:00:00Z'); // Fri 14:00 BST

function row(overrides: Partial<DueRow> = {}): DueRow {
  return {
    event_id: 'ev-1',
    kind: 'allocation',
    verdict: 'due',
    event_date: '2026-07-11',
    first_start: '2026-07-11T06:00:00+00:00',
    last_end: '2026-07-11T21:30:00+00:00',
    cancelled: false,
    confirmed: 4,
    contacts: 2,
    undetermined: 0,
    manual_allocation_at: null,
    signout_queued_at: null,
    auto_queued_at: null,
    ...overrides,
  };
}

function harness(rows: DueRow[], overrides: Partial<AutosendDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: AutosendDeps = {
    now: NOW,
    config: CONFIG,
    rows,
    claim: async (id: string, kind: DocumentKind) => {
      calls.push(`claim ${kind} ${id}`);
      return true;
    },
    generate: async (id: string, kind: DocumentKind) => {
      calls.push(`generate ${kind} ${id}`);
      return { ok: true, documentId: `doc-${id}` };
    },
    queue: async (documentId: string) => {
      calls.push(`queue ${documentId}`);
      return { queued: true };
    },
    release: async (id: string, kind: DocumentKind, error: string) => {
      calls.push(`release ${kind} ${id} ${error}`);
    },
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, calls, logs };
}

describe('one run of the event-documents job', () => {
  it('claims, draws, records and queues a due D1, in that order', async () => {
    const { deps, calls } = harness([row()]);
    const counts = await runAutosend(deps);
    expect(calls).toEqual(['claim allocation ev-1', 'generate allocation ev-1', 'queue doc-ev-1']);
    expect(counts.sent).toEqual({ allocation: 1, signout: 0 });
    expect(counts.verdicts.allocation).toEqual({ due: 1 });
  });

  it('acts only when SQL and TypeScript agree — a disagreement is counted, not sent', async () => {
    // TypeScript says not_yet at 13:59 UK; SQL (wrongly) says due.
    const { deps, calls, logs } = harness([row()], { now: new Date('2026-07-10T12:59:00Z') });
    const counts = await runAutosend(deps);
    expect(calls).toEqual([]);
    expect(counts.disagreements).toBe(1);
    expect(logs[0]).toContain('SQL says due, TypeScript not_yet');
  });

  it('does not draw or claim an Allocation Timesheet for a half-staffed event (ADR-0084)', async () => {
    const { deps, calls } = harness([row({ unfilled: 2, verdict: 'not_filled' })]);
    const counts = await runAutosend(deps);
    expect(calls).toEqual([]);
    expect(counts.due).toBe(0);
    expect(counts.verdicts.allocation).toEqual({ not_filled: 1 });
    expect(counts.disagreements).toBe(0);
    // Once the last slot is confirmed the same row goes out.
    const full = harness([row({ unfilled: 0 })]);
    await runAutosend(full.deps);
    expect(full.calls[0]).toBe('claim allocation ev-1');
  });

  it('sends an updated copy after a change, and counts it apart (ADR-0084)', async () => {
    const changed = row({
      auto_queued_at: '2026-07-10T13:00:05+00:00',
      sent_fingerprint: 'a',
      current_fingerprint: 'b',
      unfilled: 0,
    });
    const { deps, calls, logs } = harness([changed]);
    const counts = await runAutosend(deps);
    expect(calls[0]).toBe('claim allocation ev-1');
    expect(counts.sent.allocation).toBe(1);
    expect(counts.updated).toBe(1);
    expect(logs.some((l) => l.includes('(updated copy)'))).toBe(true);
    // The first copy is not an update.
    const first = harness([row()]);
    expect((await runAutosend(first.deps)).updated).toBe(0);
  });

  it('holds an updated copy while a worker still has to confirm the change', async () => {
    const awaiting = row({
      auto_queued_at: '2026-07-10T13:00:05+00:00',
      sent_fingerprint: 'a',
      current_fingerprint: 'b',
      unfilled: 1,
      verdict: 'not_filled',
    });
    const { deps, calls } = harness([awaiting]);
    const counts = await runAutosend(deps);
    expect(calls).toEqual([]);
    expect(counts.verdicts.allocation).toEqual({ not_filled: 1 });
  });

  it('records the reason for a skip in the counts and the log, without failing the run', async () => {
    const { deps, calls, logs } = harness([
      row({ event_id: 'ev-c', verdict: 'cancelled', cancelled: true }),
      row({ event_id: 'ev-n', verdict: 'no_contact_emails', contacts: 0 }),
      row({ event_id: 'ev-s', verdict: 'no_confirmed_staff', confirmed: 0 }),
      row({
        event_id: 'ev-h',
        kind: 'signout',
        verdict: 'not_yet',
      }),
    ]);
    const counts = await runAutosend(deps);
    expect(calls).toEqual([]);
    expect(counts.verdicts.allocation).toEqual({
      cancelled: 1,
      no_contact_emails: 1,
      no_confirmed_staff: 1,
    });
    expect(counts.verdicts.signout).toEqual({ not_yet: 1 });
    expect(logs).toEqual([
      'event-documents: allocation ev-c skipped: cancelled',
      'event-documents: allocation ev-n skipped: no_contact_emails',
      'event-documents: allocation ev-s skipped: no_confirmed_staff',
    ]);
  });

  it('leaves an event another run has claimed alone', async () => {
    const { deps, calls } = harness([row()], { claim: async () => false });
    const counts = await runAutosend(deps);
    expect(calls).toEqual([]);
    expect(counts.notClaimed).toBe(1);
  });

  it('gives the claim back when the PDF cannot be drawn, so the next run retries', async () => {
    const { deps, calls } = harness([row()], {
      generate: async () => ({ ok: false, message: 'Storage refused the PDF: boom' }),
    });
    const counts = await runAutosend(deps);
    expect(counts.failed).toBe(1);
    expect(calls.at(-1)).toBe('release allocation ev-1 Storage refused the PDF: boom');
  });

  it('gives the claim back when queuing throws', async () => {
    const { deps, calls } = harness([row()], {
      queue: async () => {
        throw new Error('client_has_no_contact_email');
      },
    });
    const counts = await runAutosend(deps);
    expect(counts.failed).toBe(1);
    expect(calls.at(-1)).toBe('release allocation ev-1 client_has_no_contact_email');
  });

  it('counts an outbox key that already existed as a duplicate, not a second email', async () => {
    const { deps } = harness([row()], { queue: async () => ({ queued: false }) });
    const counts = await runAutosend(deps);
    expect(counts.duplicate).toBe(1);
    expect(counts.sent.allocation).toBe(0);
  });

  it('stands down when the SQL re-check at queue time says a manager already sent it', async () => {
    const { deps, logs } = harness([row()], {
      queue: async () => ({ queued: false, skipped: 'manual_sent' }),
    });
    const counts = await runAutosend(deps);
    expect(counts.stoodDown).toBe(1);
    expect(counts.sent.allocation).toBe(0);
    expect(counts.duplicate).toBe(0);
    expect(logs.at(-1)).toBe('event-documents: allocation ev-1 stood down at queue: manual_sent');
  });

  it('passes the spent claims through, so a row that gave up is never claimed', async () => {
    const { deps, calls } = harness([row({ verdict: 'gave_up', attempts: 8 })]);
    const counts = await runAutosend(deps);
    expect(calls).toEqual([]);
    expect(counts.verdicts.allocation).toEqual({ gave_up: 1 });
  });

  it('defers what is left once the time budget is spent', async () => {
    let t = 0;
    const { deps, calls } = harness([row({ event_id: 'a' }), row({ event_id: 'b' })], {
      deadline: 5,
      clock: () => t,
      generate: async (id) => {
        t = 10;
        return { ok: true, documentId: `doc-${id}` };
      },
    });
    const counts = await runAutosend(deps);
    expect(counts.sent.allocation).toBe(1);
    expect(counts.deferred).toBe(1);
    expect(calls).not.toContain('claim allocation b');
  });

  it('sends a due D2 the morning after', async () => {
    const { deps, calls } = harness([row({ event_id: 'ev-2', kind: 'signout', verdict: 'due' })], {
      now: new Date('2026-07-12T09:00:00Z'),
    });
    const counts = await runAutosend(deps);
    expect(calls).toEqual(['claim signout ev-2', 'generate signout ev-2', 'queue doc-ev-2']);
    expect(counts.sent.signout).toBe(1);
  });
});
