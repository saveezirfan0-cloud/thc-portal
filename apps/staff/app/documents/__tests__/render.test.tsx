import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { data, doc } from './fixtures';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DocumentsHub } = await import('../_components/DocumentsHub');
const { buildDocumentsView } = await import('../model');

/**
 * The tab as markup: every state the wireframe draws reaches the page, in
 * the wireframe's `.docrow` classes, with the right action on the right row.
 */
function render(over: Parameters<typeof data>[0], locked = false): string {
  return renderToStaticMarkup(
    <DocumentsHub view={buildDocumentsView(data(over))} locked={locked} />,
  );
}

/** One payload carrying every document state at once. */
const EVERYTHING = {
  rtwBranch: 'international_student',
  cap: { hours: 20, band: 'student_term_20', label: 'term time', until: '2026-12-13' },
  missing: ['share_code'],
  documents: [
    doc({
      id: 'pp',
      docType: 'passport',
      reviewStatus: 'rejected',
      rejectionReason: 'Photo is blurred — please re-take',
      isCountedVerified: false,
    }),
    doc({
      id: 'pp0',
      docType: 'passport',
      reviewStatus: 'superseded',
      isCurrent: false,
      isCountedVerified: false,
    }),
    doc({ id: 'visa', docType: 'visa_document', label: 'Visa document', expiresOn: '2026-10-05' }),
    doc({ id: 'ni', docType: 'ni_evidence', label: 'NI evidence', expiresOn: '2026-09-20' }),
    doc({
      id: 'st',
      docType: 'status_document',
      label: 'Status document',
      reviewStatus: 'pending',
      isCountedVerified: false,
      expiresOn: null,
    }),
    doc({
      id: 'tl',
      docType: 'university_term_dates_letter',
      label: 'University Term Dates Letter',
      expiresOn: '2026-12-31',
    }),
    doc({
      id: 'cl',
      docType: 'university_completion_letter',
      reviewStatus: 'pending',
      evidenceForm: 'letter',
      completionDateClaimed: '2027-06-30',
      expiresOn: null,
      isCountedVerified: false,
    }),
  ],
};

describe('the Documents tab renders every state', () => {
  const html = render(EVERYTHING);

  it.each([
    ['verified', 'University Term Dates Letter'],
    ['expiring', 'Visa document'],
    ['expired', 'NI evidence'],
    ['in_review', 'Status document'],
    ['rejected', 'Passport'],
    ['missing', 'Right to work · share code'],
    ['superseded', 'Passport'],
  ])('%s', (state, title) => {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const row = new RegExp(
      `data-state="${state}"[^>]*><span[^>]*>[^<]*</span><div><div class="t">${escaped}</div>`,
    );
    expect(html).toMatch(row);
  });

  it('the rejection reason is on the row with a primary Re-upload', () => {
    expect(html).toContain('Re-upload · “Photo is blurred — please re-take”');
    expect(html).toContain(
      '<a href="/documents/upload/passport" class="btn primary sm">Re-upload</a>',
    );
  });

  it('the completion letter in review says nothing has changed yet', () => {
    expect(html).toMatch(/data-kind="university_completion_letter"/);
    expect(html).toContain('your limit stays at 20 h until the office approves it');
  });

  it('the opt-out row is there for an adult', () => {
    expect(html).toContain('data-state="optout:not_signed"');
    expect(html).toContain('href="/documents/opt-out"');
  });

  it('the declaration action sits at the foot, set apart (§10.7)', () => {
    const declare = html.indexOf('class="declare"');
    expect(declare).toBeGreaterThan(html.lastIndexOf('docrow'));
    expect(html).toContain('href="/documents/declare"');
  });

  it('the status line carries the calculated cap', () => {
    expect(html).toContain('International student · 20 h/week — term time until 13.12.2026');
  });
});

describe('locked and not-locked', () => {
  it('a compliant worker sees no lock note', () => {
    expect(render({})).not.toContain('are locked until every document');
  });

  it('a worker locked to Documents is told Shifts, Invites and Radar are closed', () => {
    const html = render({ status: 'blocked', blockKind: 'auto_document' }, true);
    expect(html).toContain('Shifts, Invites and Radar are locked until every document is verified');
    expect(html).toContain('href="/documents/declare"');
  });

  it('the gov.uk check line shows under a pending share code, and only there (ADR-0025)', () => {
    const pending = data({
      documents: [
        doc({
          docType: 'share_code_report',
          label: 'Right to work · share code',
          reviewStatus: 'pending',
          hasFile: false,
          isCountedVerified: false,
          expiresOn: null,
        }),
      ],
    });
    const line = 'Checked with gov.uk — the office is reviewing the result.';
    const html = renderToStaticMarkup(
      <DocumentsHub view={buildDocumentsView(pending, { line, checkedAt: null })} locked={false} />,
    );
    expect(html).toContain(`<div class="m" data-testid="rtw-check-line">${line}</div>`);
    expect(render({})).not.toContain('rtw-check-line');
  });

  it('a manual hold has no Upload and no Declare — nothing to fix (§10.1 case 2)', () => {
    const html = render({
      status: 'blocked',
      blockKind: 'manual',
      documents: [doc({ expiresOn: '2026-09-20' })],
    });
    expect(html).not.toContain('/documents/upload/');
    expect(html).not.toContain('/documents/declare');
  });
});
