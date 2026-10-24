import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  IllegalTransitionError,
  TIMESHEET_JOB_STATUSES,
  TIMESHEET_JOB_TRANSITIONS,
  assertInvoiceTransition,
  assertTimesheetJobTransition,
  canTransitionInvoice,
  canTransitionTimesheetJob,
} from '../state.ts';

const MIGRATIONS = new URL('../../../../supabase/migrations/', import.meta.url);

/**
 * The (from, to) pairs of the LATEST migration that defines `fn` — migrations
 * are forward-only, so the last `create or replace` is the one in force.
 */
function latestPairs(fn: string): string[] {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files.reverse()) {
    const sql = readFileSync(new URL(file, MIGRATIONS), 'utf8');
    const at = sql.lastIndexOf(`create or replace function public.${fn}()`);
    if (at < 0) continue;
    const body = sql.slice(at);
    const values = body.slice(body.indexOf('(values'), body.indexOf(') v(from_status'));
    return [...values.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}→${m[2]}`);
  }
  throw new Error(`${fn}() is defined in no migration`);
}

/** ADR-0176 + ADR-0210: the issued invoice's states, held equal to the database's. */
describe('invoice transitions (ADR-0176, ADR-0210)', () => {
  it('queued and generated may only be voided; void is terminal', () => {
    expect(INVOICE_TRANSITIONS.queued).toEqual(['void']);
    expect(INVOICE_TRANSITIONS.generated).toEqual(['queued', 'void']);
    expect(INVOICE_TRANSITIONS.void).toEqual([]);
    for (const to of INVOICE_STATUSES) {
      expect(canTransitionInvoice('void', to)).toBe(to === 'void');
    }
    expect(() => assertInvoiceTransition('queued', 'drawing')).toThrow(IllegalTransitionError);
    expect(() => assertInvoiceTransition('void', 'generated')).toThrow(IllegalTransitionError);
    expect(() => assertInvoiceTransition('generated', 'failed')).toThrow(IllegalTransitionError);
  });

  it('a failed run is retried and may still finish', () => {
    expect(canTransitionInvoice('drawing', 'failed')).toBe(true);
    expect(canTransitionInvoice('failed', 'drawing')).toBe(true);
    expect(canTransitionInvoice('failed', 'queued')).toBe(true);
    expect(canTransitionInvoice('failed', 'generated')).toBe(true);
  });

  it('a timesheet invoice is drawn, generated, then sent', () => {
    expect(canTransitionInvoice('drawing', 'generated')).toBe(true);
    expect(canTransitionInvoice('generated', 'queued')).toBe(true);
    expect(canTransitionInvoice('queued', 'generated')).toBe(false);
  });

  it('lists exactly the pairs invoice_status_transitions() holds', () => {
    const ts = INVOICE_STATUSES.flatMap((from) =>
      INVOICE_TRANSITIONS[from].map((to) => `${from}→${to}`),
    );
    expect(latestPairs('invoice_status_transitions').sort()).toEqual(ts.sort());
  });
});

describe('timesheet job transitions (ADR-0210)', () => {
  it('runs uploaded → extracting → reviewing → confirmed → complete', () => {
    expect(canTransitionTimesheetJob('uploaded', 'extracting')).toBe(true);
    expect(canTransitionTimesheetJob('extracting', 'reviewing')).toBe(true);
    expect(canTransitionTimesheetJob('reviewing', 'confirmed')).toBe(true);
    expect(canTransitionTimesheetJob('confirmed', 'complete')).toBe(true);
  });

  it('cannot skip a step or leave uploaded for reviewing', () => {
    expect(canTransitionTimesheetJob('uploaded', 'reviewing')).toBe(false);
    expect(canTransitionTimesheetJob('extracting', 'confirmed')).toBe(false);
    expect(() => assertTimesheetJobTransition('uploaded', 'complete')).toThrow(
      IllegalTransitionError,
    );
  });

  it('an error is retried; a voided invoice reopens a complete job', () => {
    expect(canTransitionTimesheetJob('error', 'extracting')).toBe(true);
    expect(canTransitionTimesheetJob('error', 'reviewing')).toBe(false);
    expect(canTransitionTimesheetJob('complete', 'reviewing')).toBe(true);
    expect(canTransitionTimesheetJob('complete', 'confirmed')).toBe(false);
  });

  it('lists exactly the pairs timesheet_job_transitions() holds', () => {
    const ts = TIMESHEET_JOB_STATUSES.flatMap((from) =>
      TIMESHEET_JOB_TRANSITIONS[from].map((to) => `${from}→${to}`),
    );
    expect(latestPairs('timesheet_job_transitions').sort()).toEqual(ts.sort());
  });
});
