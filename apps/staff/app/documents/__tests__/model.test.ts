import { describe, expect, it } from 'vitest';
import { buildDocumentsView, capLine, formatDay, optOutView } from '../model';
import type { DocRowView } from '../model';
import { data, doc } from './fixtures';

/**
 * The Documents tab's view model — every state `wireframes/staff/
 * documents.html` draws, from the payload `staff_documents()` returns.
 */

const rowOf = (rows: DocRowView[], kind: string) => rows.find((r) => r.kind === kind)!;

describe('document rows — every §4.4 state', () => {
  it('verified, with the expiry the block is measured on', () => {
    const view = buildDocumentsView(data());
    const row = rowOf(view.rows, 'passport');
    expect(row.state).toBe('verified');
    expect(row.meta).toBe('Verified · expires 14.03.2031');
    expect(row.pill).toEqual({ tone: 'green', text: 'Verified' });
    expect(row.action).toBeNull();
  });

  it('expiring inside 30 days, with an Upload for the replacement', () => {
    const view = buildDocumentsView(data({ documents: [doc({ expiresOn: '2026-10-05' })] }));
    const row = rowOf(view.rows, 'passport');
    expect(row.state).toBe('expiring');
    expect(row.meta).toBe('Expires 05.10.2026 (12 days) — upload the renewed one');
    expect(row.action).toEqual({
      label: 'Upload',
      href: '/documents/upload/passport',
      primary: true,
    });
    expect(view.attention?.headline).toBe('1 document needs your attention.');
  });

  it('expired, coral, with Upload (§4.3 case 1)', () => {
    const view = buildDocumentsView(
      data({
        status: 'blocked',
        blockKind: 'auto_document',
        documents: [doc({ expiresOn: '2026-09-17' })],
      }),
    );
    const row = rowOf(view.rows, 'passport');
    expect(row.state).toBe('expired');
    expect(row.tone).toBe('expired');
    expect(row.meta).toBe('Expired 17.09.2026');
    expect(row.metaTone).toBe('coral');
    expect(row.action?.href).toBe('/documents/upload/passport');
    expect(view.statusPill).toEqual({ tone: 'coral', text: 'Blocked' });
    // The lock's own alert carries a blocked worker's message, not this banner.
    expect(view.attention).toBeNull();
  });

  it('in review — and the old one keeps counting until it expires', () => {
    const view = buildDocumentsView(
      data({
        documents: [
          doc({
            id: 'new',
            reviewStatus: 'pending',
            uploadedAt: '2026-09-20T09:00:00+00:00',
            isCurrent: true,
            isCountedVerified: false,
            expiresOn: null,
          }),
          doc({ id: 'old', isCurrent: false, isCountedVerified: true, expiresOn: '2026-10-05' }),
        ],
      }),
    );
    const row = rowOf(view.rows, 'passport');
    expect(row.state).toBe('in_review');
    expect(row.meta).toBe(
      'In review · uploaded 20.09.2026 · your current one stays valid until 05.10.2026',
    );
    expect(row.pill).toEqual({ tone: 'amber', text: 'In review' });
    expect(row.action).toBeNull();
    expect(view.statusPill.text).toBe('Compliant');
  });

  it('rejected, with the manager’s reason word for word and Re-upload (§4.1, N8)', () => {
    const view = buildDocumentsView(
      data({
        documents: [
          doc({
            reviewStatus: 'rejected',
            rejectionReason: 'Photo is blurred — please re-take',
            isCountedVerified: false,
          }),
        ],
      }),
    );
    const row = rowOf(view.rows, 'passport');
    expect(row.state).toBe('rejected');
    expect(row.meta).toBe('Re-upload · “Photo is blurred — please re-take”');
    expect(row.metaTone).toBe('coral');
    expect(row.action).toEqual({
      label: 'Re-upload',
      href: '/documents/upload/passport',
      primary: true,
    });
  });

  it('missing — a branch document never supplied, and a share code never entered', () => {
    const view = buildDocumentsView(data({ missing: ['visa_document', 'share_code', 'dob'] }));
    expect(rowOf(view.rows, 'visa_document')).toMatchObject({
      state: 'missing',
      meta: 'Missing',
      action: { label: 'Upload', href: '/documents/upload/visa_document', primary: true },
    });
    expect(rowOf(view.rows, 'share_code_report')).toMatchObject({
      state: 'missing',
      action: { label: 'Enter code', href: '/documents/upload/share_code_report' },
    });
    // A token that is not a document is not a row.
    expect(view.rows.some((r) => (r.kind as string) === 'dob')).toBe(false);
  });

  it('superseded evidence is read-only history, never a current row (§2.12)', () => {
    const view = buildDocumentsView(
      data({
        documents: [
          doc({}),
          doc({
            id: 'old',
            reviewStatus: 'superseded',
            isCurrent: false,
            isCountedVerified: false,
            uploadedAt: '2024-03-01T10:00:00+00:00',
          }),
        ],
      }),
    );
    expect(view.rows.filter((r) => r.kind === 'passport')).toHaveLength(1);
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({
      state: 'superseded',
      meta: 'Superseded · uploaded 01.03.2024 · kept on record, read-only',
      action: null,
    });
  });

  it('a share code reads as the right-to-work date (gov.uk)', () => {
    const view = buildDocumentsView(
      data({
        documents: [
          doc({
            docType: 'share_code_report',
            label: 'Right to work · share code',
            expiresOn: '2028-01-31',
            hasFile: false,
          }),
        ],
      }),
    );
    expect(rowOf(view.rows, 'share_code_report').meta).toBe(
      'Verified · right to work until 31.01.2028 (gov.uk)',
    );
  });

  it('a new share code in review names the code by its tail only', () => {
    const view = buildDocumentsView(
      data({
        documents: [
          doc({
            docType: 'share_code_report',
            reviewStatus: 'pending',
            shareCodeTail: '6XK',
            hasFile: false,
            uploadedAt: '2026-09-22T09:00:00+00:00',
            isCountedVerified: false,
          }),
        ],
      }),
    );
    expect(rowOf(view.rows, 'share_code_report').meta).toBe(
      'In review · new code ending 6XK entered 22.09.2026',
    );
  });

  it('a graduate’s term letter is not needed rather than expired (§4.5)', () => {
    const view = buildDocumentsView(
      data({
        rtwBranch: 'international_student',
        termLetterApplies: false,
        documents: [
          doc({
            docType: 'university_term_dates_letter',
            label: 'University Term Dates Letter',
            expiresOn: '2025-12-31',
          }),
        ],
      }),
    );
    const row = rowOf(view.rows, 'university_term_dates_letter');
    expect(row.state).toBe('not_needed');
    expect(row.action).toBeNull();
    expect(view.attention).toBeNull();
  });

  it('orders what needs the worker first, the declaration last', () => {
    const view = buildDocumentsView(
      data({
        documents: [
          doc({ docType: 'visa_document', label: 'Visa document' }),
          doc({
            docType: 'passport',
            reviewStatus: 'rejected',
            rejectionReason: 'Blurred',
            isCountedVerified: false,
          }),
        ],
      }),
    );
    expect(view.rows.map((r) => r.state)).toEqual(['rejected', 'verified', 'verified']);
    expect(view.rows.at(-1)?.kind).toBe('criminal_declaration');
  });
});

describe('the criminal conviction declaration row (§10.7)', () => {
  it('a No at onboarding is verified', () => {
    const row = rowOf(buildDocumentsView(data()).rows, 'criminal_declaration');
    expect(row.meta).toBe('Verified · answered “No” at onboarding, 18.09.2026');
  });

  it('a declaration under review never shows its details', () => {
    const view = buildDocumentsView(
      data({
        status: 'blocked',
        blockKind: 'conviction_review',
        declarations: [
          {
            id: 'decl-2',
            source: 'in_employment',
            answer: true,
            declaredAt: '2026-09-18T13:44:00+00:00',
            reviewStatus: 'pending',
            superseded: false,
          },
        ],
      }),
    );
    const row = rowOf(view.rows, 'criminal_declaration');
    expect(row.state).toBe('in_review');
    // An audit stamp, UK time (BST in September).
    expect(row.meta).toBe('In review · declared 18.09.2026 14:44 · details not shown here');
  });

  it('is available to a compliant worker and to one locked to Documents, never to a manual hold', () => {
    expect(buildDocumentsView(data()).canDeclare).toBe(true);
    expect(
      buildDocumentsView(data({ status: 'blocked', blockKind: 'auto_document' })).canDeclare,
    ).toBe(true);
    expect(buildDocumentsView(data({ status: 'blocked', blockKind: 'manual' })).canDeclare).toBe(
      false,
    );
    expect(buildDocumentsView(data({ status: 'documents' })).canDeclare).toBe(false);
  });
});

describe('the completion letter slot (requirement §2.1, §4.5)', () => {
  const student = { rtwBranch: 'international_student' };

  it('is not offered outside a Student visa', () => {
    expect(buildDocumentsView(data()).completion).toBeNull();
  });

  it('optional, with Upload, for a student with none', () => {
    const slot = buildDocumentsView(data(student)).completion!;
    expect(slot.state).toBe('optional');
    expect(slot.action?.href).toBe('/documents/completion-letter');
    expect(slot.meta).toContain('Once the office approves it');
  });

  it('in review says the limit has NOT changed (acceptance criterion 2)', () => {
    const slot = buildDocumentsView(
      data({
        ...student,
        cap: { hours: 20, band: 'student_term_20', label: 'term time', until: '2026-12-13' },
        documents: [
          doc({
            docType: 'university_completion_letter',
            label: 'Official University Completion Letter',
            reviewStatus: 'pending',
            evidenceForm: 'transcript',
            completionDateClaimed: '2026-06-30',
            expiresOn: null,
            isCountedVerified: false,
          }),
        ],
      }),
    ).completion!;
    expect(slot.state).toBe('in_review');
    expect(slot.meta).toBe(
      'In review · Final / completers transcript showing the award or completion date · completion date 30.06.2026 · your limit stays at 20 h until the office approves it',
    );
  });

  it('rejected, with the reason and Re-upload', () => {
    const slot = buildDocumentsView(
      data({
        ...student,
        documents: [
          doc({
            docType: 'university_completion_letter',
            reviewStatus: 'rejected',
            rejectionReason: 'No completion date on the letter',
            expiresOn: null,
            isCountedVerified: false,
          }),
        ],
      }),
    ).completion!;
    expect(slot.state).toBe('rejected');
    expect(slot.meta).toContain('“No completion date on the letter”');
    expect(slot.action?.label).toBe('Re-upload');
  });

  it('approved with a FUTURE completion date lifts nothing yet', () => {
    const slot = buildDocumentsView(
      data({
        ...student,
        graduatedAt: '2026-09-21',
        courseCompletionDate: '2026-10-14',
        documents: [
          doc({
            docType: 'university_completion_letter',
            completionDate: '2026-10-14',
            expiresOn: null,
          }),
        ],
      }),
    ).completion!;
    // First full Mon–Sun week on/after Wed 14.10 is Mon 19.10.
    expect(slot.meta).toBe(
      'Approved · 48 h/week from 19.10.2026 — until then your current limit applies',
    );
  });

  it('approved with a past completion date is in force', () => {
    const slot = buildDocumentsView(
      data({
        ...student,
        graduatedAt: '2026-07-03',
        documents: [
          doc({
            docType: 'university_completion_letter',
            completionDate: '2026-06-29',
            expiresOn: null,
          }),
        ],
      }),
    ).completion!;
    expect(slot.meta).toBe('Approved · 48 h/week since 03.07.2026 (course completed 29.06.2026)');
  });
});

describe('the 48-hour opt-out (requirement §2.4)', () => {
  it('is not offered to an under-18, nor without a date of birth', () => {
    expect(optOutView(data({ dob: '2009-01-01' }))).toBeNull();
    expect(optOutView(data({ dob: null }))).toBeNull();
  });

  it('is offered, unsigned, to an adult', () => {
    expect(optOutView(data())).toMatchObject({
      state: 'not_signed',
      action: { href: '/documents/opt-out' },
    });
  });

  it('signed shows the notice period', () => {
    const view = optOutView(
      data({
        optOut: {
          signed: true,
          signedAt: '2026-09-01T10:00:00+00:00',
          noticeDays: 30,
          cancelledFrom: null,
          hasSignedCopy: false,
        },
      }),
    )!;
    expect(view.state).toBe('signed');
    expect(view.meta).toContain('Signed 01.09.2026 · cancel any time with 30 days’ notice');
  });

  it('cancelled shows the day the 48-hour limit returns — the END of the notice', () => {
    const view = optOutView(
      data({
        optOut: {
          signed: true,
          signedAt: '2026-09-01T10:00:00+00:00',
          noticeDays: 7,
          cancelledFrom: '2026-09-30',
          hasSignedCopy: false,
        },
      }),
    )!;
    expect(view.state).toBe('cancelling');
    expect(view.meta).toBe(
      'Cancelled · the 48-hour limit returns on 30.09.2026, at the end of your 7 days’ notice',
    );
  });
});

describe('the status line', () => {
  it('words the calculated cap, never a typed one (RULE-20)', () => {
    expect(
      capLine(
        data({
          rtwBranch: 'international_student',
          cap: { hours: 20, band: 'student_term_20', label: 'term time', until: '2026-12-13' },
        }),
      ),
    ).toBe('International student · 20 h/week — term time until 13.12.2026');
    expect(
      capLine(
        data({
          cap: {
            hours: null,
            band: 'uncapped',
            label: 'you have signed the 48-hour opt-out',
            until: null,
          },
        }),
      ),
    ).toBe('Work visa · no weekly limit — you have signed the 48-hour opt-out');
  });

  it('formats UK calendar days as DD.MM.YYYY', () => {
    expect(formatDay('2026-12-31')).toBe('31.12.2026');
  });
});

describe('the gov.uk share-code check line (ADR-0025)', () => {
  const CHECKING = { line: 'Checking with gov.uk…', checkedAt: null };
  const CHECKED_AT = '2026-09-22T09:02:00+00:00';
  const pendingShare = (over: Record<string, unknown> = {}) =>
    data({
      documents: [
        doc({
          docType: 'share_code_report',
          label: 'Right to work · share code',
          reviewStatus: 'pending',
          shareCodeTail: '6XK',
          hasFile: false,
          uploadedAt: '2026-09-22T09:00:00+00:00',
          isCountedVerified: false,
          expiresOn: null,
          ...over,
        }),
        doc({ id: 'pp' }),
      ],
    });
  const shareRow = (view: ReturnType<typeof buildDocumentsView>) =>
    rowOf(view.rows, 'share_code_report');

  it('without a check, the share code row reads as it always did', () => {
    const row = shareRow(buildDocumentsView(pendingShare()));
    expect(row.meta).toBe('In review · new code ending 6XK entered 22.09.2026');
    expect(row.note ?? null).toBeNull();
    expect(shareRow(buildDocumentsView(pendingShare(), null)).note ?? null).toBeNull();
  });

  it.each([
    ['queued / running', CHECKING],
    [
      'done · pass',
      { line: 'Checked with gov.uk — the office is confirming it.', checkedAt: CHECKED_AT },
    ],
    [
      'done · another outcome',
      { line: 'Checked with gov.uk — the office is reviewing the result.', checkedAt: CHECKED_AT },
    ],
    [
      'failed',
      {
        line: 'We couldn’t check with gov.uk automatically — the office will check it by hand.',
        checkedAt: CHECKED_AT,
      },
    ],
  ])('%s — the line sits under the pending share code, meta and pill unchanged', (_, check) => {
    expect(shareRow(buildDocumentsView(pendingShare(), check))).toMatchObject({
      state: 'in_review',
      meta: 'In review · new code ending 6XK entered 22.09.2026',
      note: check.line,
      pill: { tone: 'amber', text: 'In review' },
      action: null,
    });
  });

  it('never on a verified or rejected share code — the existing row is the whole story', () => {
    const verified = shareRow(
      buildDocumentsView(
        pendingShare({
          reviewStatus: 'verified',
          expiresOn: '2028-01-31',
          isCountedVerified: true,
        }),
        CHECKING,
      ),
    );
    expect(verified.meta).toBe('Verified · right to work until 31.01.2028 (gov.uk)');
    expect(verified.note ?? null).toBeNull();

    const rejected = shareRow(
      buildDocumentsView(
        pendingShare({ reviewStatus: 'rejected', rejectionReason: 'Code has expired' }),
        CHECKING,
      ),
    );
    expect(rejected).toMatchObject({
      meta: 'Re-upload · “Code has expired”',
      action: { label: 'Enter new code' },
    });
    expect(rejected.note ?? null).toBeNull();
  });

  it('never on any other document, even one in review', () => {
    const view = buildDocumentsView(
      data({
        documents: [doc({ reviewStatus: 'pending', isCountedVerified: false, expiresOn: null })],
      }),
      CHECKING,
    );
    expect(rowOf(view.rows, 'passport').note ?? null).toBeNull();
  });

  it('a check finished before this code was entered is about an earlier code', () => {
    const stale = {
      line: 'Checked with gov.uk — the office is confirming it.',
      checkedAt: '2026-09-01T12:00:00+00:00',
    };
    expect(shareRow(buildDocumentsView(pendingShare(), stale)).note ?? null).toBeNull();
  });
});
