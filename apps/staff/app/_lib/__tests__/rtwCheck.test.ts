import { describe, expect, it } from 'vitest';
import { parseMyRtwChecks } from '../rtwCheck';

/** `my_rtw_checks()` rows (ADR-0025) — synthetic. */
describe('parseMyRtwChecks', () => {
  it('keys the worker’s checks by document, status and reason only', () => {
    expect(
      parseMyRtwChecks([
        {
          document_id: 'd1',
          status: 'rejected',
          outcome: 'not_found',
          worker_reason: 'check both and try again',
          created_at: '2026-09-25T07:00:00Z',
          checked_at: '2026-09-25T07:01:00Z',
        },
        { document_id: 'd2', status: 'bogus' },
        { status: 'queued' },
      ]),
    ).toEqual({
      d1: {
        documentId: 'd1',
        status: 'rejected',
        outcome: 'not_found',
        workerReason: 'check both and try again',
        checkedAt: '2026-09-25T07:01:00Z',
      },
    });
  });

  it('reads nothing from a failed or empty answer', () => {
    expect(parseMyRtwChecks(null)).toEqual({});
    expect(parseMyRtwChecks({})).toEqual({});
  });
});
