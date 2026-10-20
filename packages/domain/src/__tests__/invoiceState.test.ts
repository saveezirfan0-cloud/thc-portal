import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  IllegalTransitionError,
  assertInvoiceTransition,
  canTransitionInvoice,
} from '../state.ts';

/** ADR-0175: the issued invoice's states, held equal to the database's. */
describe('invoice transitions (ADR-0175)', () => {
  it('queued is final', () => {
    expect(INVOICE_TRANSITIONS.queued).toEqual([]);
    for (const to of INVOICE_STATUSES) {
      expect(canTransitionInvoice('queued', to)).toBe(to === 'queued');
    }
    expect(() => assertInvoiceTransition('queued', 'drawing')).toThrow(IllegalTransitionError);
  });

  it('a failed run is retried and may still finish', () => {
    expect(canTransitionInvoice('drawing', 'failed')).toBe(true);
    expect(canTransitionInvoice('failed', 'drawing')).toBe(true);
    expect(canTransitionInvoice('failed', 'queued')).toBe(true);
  });

  it('lists exactly the pairs invoice_status_transitions() holds', () => {
    const sql = readFileSync(
      new URL('../../../../supabase/migrations/20261022100000_invoices_sent.sql', import.meta.url),
      'utf8',
    );
    const body = sql.slice(sql.indexOf('function public.invoice_status_transitions()'));
    const values = body.slice(body.indexOf('(values'), body.indexOf(') v(from_status'));
    const pairs = [...values.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}→${m[2]}`);
    const ts = INVOICE_STATUSES.flatMap((from) =>
      INVOICE_TRANSITIONS[from].map((to) => `${from}→${to}`),
    );
    expect(pairs.sort()).toEqual(ts.sort());
  });
});
