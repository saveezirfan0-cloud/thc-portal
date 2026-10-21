import { describe, expect, it } from 'vitest';
import { buildDocumentsView } from '../model';
import type { DocRowView } from '../model';
import { data, doc } from './fixtures';

/**
 * The Home Office check result on the worker's Documents tab (ADR-0182).
 * Only an employer can ask the Home Office, so the office attaches and
 * renews it: every state is shown, and none offers the worker an upload or
 * tells them to renew it.
 */
const row = (rows: DocRowView[]) => rows.find((r) => r.kind === 'home_office_check_result')!;
const result = (over: Parameters<typeof doc>[0] = {}) =>
  doc({
    docType: 'home_office_check_result',
    label: 'Right to work · Home Office check',
    ...over,
  });

describe('the Home Office check result — never the worker’s to upload', () => {
  it('verified: the right-to-work date', () => {
    const view = buildDocumentsView(
      data({ rtwBranch: 'home_office_check', documents: [result({ expiresOn: '2027-03-20' })] }),
    );
    expect(row(view.rows).meta).toBe(
      'Verified · right to work until 20.03.2027 (Home Office check)',
    );
    expect(row(view.rows).action).toBeNull();
  });

  it('expiring: the office renews it, no Upload, no "needs your attention" banner', () => {
    const view = buildDocumentsView(
      data({ rtwBranch: 'home_office_check', documents: [result({ expiresOn: '2026-10-05' })] }),
    );
    expect(row(view.rows).state).toBe('expiring');
    expect(row(view.rows).meta).toBe(
      'Right to work until 05.10.2026 (12 days) — the office renews your Home Office check',
    );
    expect(row(view.rows).action).toBeNull();
    expect(view.attention).toBeNull();
  });

  it('expired: the office is renewing it, no Upload', () => {
    const view = buildDocumentsView(
      data({
        status: 'blocked',
        blockKind: 'auto_document',
        rtwBranch: 'home_office_check',
        documents: [result({ expiresOn: '2026-09-17' })],
      }),
    );
    expect(row(view.rows).meta).toBe(
      'Expired 17.09.2026 — the office is renewing your Home Office check',
    );
    expect(row(view.rows).action).toBeNull();
  });

  it('waiting for the office, then in review once the result is attached', () => {
    const waiting = buildDocumentsView(
      data({
        rtwBranch: 'home_office_check',
        documents: [result({ reviewStatus: 'pending', hasFile: false, expiresOn: null })],
      }),
    );
    expect(row(waiting.rows).meta).toBe(
      'With the office · they are checking your right to work with the Home Office',
    );
    const attached = buildDocumentsView(
      data({
        rtwBranch: 'home_office_check',
        documents: [
          result({
            reviewStatus: 'pending',
            hasFile: true,
            expiresOn: null,
            uploadedAt: '2026-09-22T09:00:00+00:00',
          }),
        ],
      }),
    );
    expect(row(attached.rows).meta).toBe(
      'In review · the office has the Home Office’s result, received 22.09.2026',
    );
    expect(row(attached.rows).action).toBeNull();
  });

  it('not accepted: the reason, and the office will be in touch — no Re-upload', () => {
    const view = buildDocumentsView(
      data({
        rtwBranch: 'home_office_check',
        documents: [
          result({ reviewStatus: 'rejected', rejectionReason: 'Negative verification notice' }),
        ],
      }),
    );
    expect(row(view.rows).meta).toBe(
      'Not accepted · “Negative verification notice” · the office will be in touch',
    );
    expect(row(view.rows).action).toBeNull();
  });

  it('missing: the office adds it — no Upload', () => {
    const view = buildDocumentsView(
      data({
        rtwBranch: 'home_office_check',
        documents: [],
        missing: ['home_office_check_result'],
      }),
    );
    expect(row(view.rows).state).toBe('missing');
    expect(row(view.rows).action).toBeNull();
    expect(view.attention).toBeNull();
  });

  it('the cap line names the route', () => {
    const view = buildDocumentsView(data({ rtwBranch: 'home_office_check', documents: [] }));
    expect(view.capLine).toMatch(/^Home Office check/);
  });
});
