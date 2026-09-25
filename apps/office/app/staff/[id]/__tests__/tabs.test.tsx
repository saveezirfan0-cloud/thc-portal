import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ViolationRow as DetailViolationRow } from '../../../checkin/types';
import type { DeclarationRow, DocumentRow, ProfileRow, ShiftRow, ViolationRow } from '../types';

// Outside Next there is no router and no server; neither is under test.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../../onboarding/actions', () => ({ documentLink: vi.fn() }));
vi.mock('../../../compliance/actions', () => ({
  verifyDeclaration: vi.fn(),
  rejectDeclaration: vi.fn(),
}));
vi.mock('../../../checkin/actions', () => ({ resolveViolation: vi.fn() }));

const { Documents } = await import('../Documents');
const { Shifts } = await import('../Shifts');
const { declarationActionable, declarationMeta } = await import('../profile');

const PROFILE = {
  id: 's1',
  status: 'compliant',
  contract_signed_at: null,
  photo_path: null,
  photo_url: null,
} as unknown as ProfileRow;

const doc = (over: Partial<DocumentRow>): DocumentRow => ({
  id: 'd1',
  doc_type: 'passport',
  doc_label: 'Passport',
  review_status: 'verified',
  superseded: false,
  file_path: null,
  gov_report_path: null,
  uploaded_at: '2026-07-10T11:00:00Z',
  expiry_date: null,
  expires_on: null,
  ai_confidence: null,
  needs_manual_review: false,
  rejection_reason: null,
  reviewed_at: null,
  reviewed_by_name: null,
  share_code: null,
  right_to_work_until: null,
  rtw_no_time_limit: false,
  completion_date: null,
  awarding_institution: null,
  ...over,
});

const decl = (over: Partial<DeclarationRow>): DeclarationRow => ({
  id: 'x1',
  source: 'onboarding',
  answer: false,
  details: null,
  conviction_date: null,
  review_status: 'verified',
  declared_at: '2026-07-09T17:12:00Z',
  reviewed_at: null,
  ...over,
});

const count = (html: string, text: string) => html.split(text).length - 1;

describe('Documents tab (§9.6)', () => {
  it('offers Download on a document with a file, and says so when there is none', () => {
    const html = renderToStaticMarkup(
      <Documents
        profile={PROFILE}
        documents={[doc({ id: 'd1', file_path: 's1/passport.pdf' }), doc({ id: 'd2' })]}
      />,
    );
    expect(count(html, '>Download<')).toBe(1);
    expect(html).toContain('no file to download');
  });

  it('offers the gov.uk report where one is stored', () => {
    const html = renderToStaticMarkup(
      <Documents
        profile={PROFILE}
        documents={[doc({ doc_label: 'Share code', gov_report_path: 's1/report.pdf' })]}
      />,
    );
    expect(html).toContain('gov.uk report');
  });

  it('lists the criminal declaration, with Verify / Reject only on a Yes under review', () => {
    const html = renderToStaticMarkup(
      <Documents
        profile={PROFILE}
        documents={[]}
        declarations={[
          decl({ id: 'x1', answer: false }),
          decl({ id: 'x2', answer: true, review_status: 'pending', source: 'in_employment' }),
        ]}
      />,
    );
    expect(html).toContain('Criminal Record declaration · No');
    expect(html).toContain('Criminal Record declaration · Yes');
    expect(count(html, '>Verify<')).toBe(1);
    expect(count(html, '>Reject<')).toBe(1);
    expect(html).not.toContain('No documents on file.');
  });

  it('shows the selfie with a download of its signed link', () => {
    const html = renderToStaticMarkup(
      <Documents
        profile={
          { ...PROFILE, photo_path: 's1/selfie.jpg', photo_url: 'https://signed/s1' } as ProfileRow
        }
        documents={[]}
      />,
    );
    expect(html).toContain('Profile selfie');
    expect(html).toContain('href="https://signed/s1"');
  });
});

describe('declaration rows', () => {
  it('only a Yes still pending is the manager’s to decide', () => {
    expect(declarationActionable(decl({ answer: true, review_status: 'pending' }))).toBe(true);
    expect(declarationActionable(decl({ answer: false, review_status: 'pending' }))).toBe(false);
    expect(declarationActionable(decl({ answer: true, review_status: 'verified' }))).toBe(false);
    expect(declarationActionable(decl({ answer: true, review_status: 'superseded' }))).toBe(false);
  });

  it('stamps in UK time and never offers a file', () => {
    const line = declarationMeta(decl({}));
    expect(line).toContain('Onboarding · declared 09.07.2026 18:12 UK time');
    expect(line).toContain('auto-verified on submission');
    expect(line).toContain('no file to download');
  });
});

const VIOLATION: ViolationRow = {
  id: 'v1',
  booking_id: 'b1',
  type: 'left_early',
  detected_at: '2026-09-17T21:48:00Z',
  minutes_late: null,
  resolved: false,
  resolved_at: null,
  resolution_note: null,
  resolved_by_name: null,
  starts_at: '2026-09-17T16:00:00Z',
  ends_at: '2026-09-17T22:30:00Z',
  role_name: 'Waiting Staff',
  event_title: 'Press Night',
  event_date: '2026-09-17',
  client_name: 'Mandarin Oriental',
  venue_name: 'Mandarin Oriental',
};

const DETAIL: DetailViolationRow = {
  id: 'v1',
  bookingId: 'b1',
  staffName: 'Omar S.',
  photoUrl: null,
  eventTitle: 'Press Night',
  venueName: 'Mandarin Oriental',
  roleName: 'Waiting Staff',
  startsAt: VIOLATION.starts_at,
  endsAt: VIOLATION.ends_at,
  type: 'left_early',
  detectedAt: VIOLATION.detected_at,
  minutesLate: null,
  resolved: false,
  resolvedAt: null,
  resolvedByName: null,
  resolutionNote: null,
  actualFinishAt: null,
  checkInAt: '2026-09-17T16:58:00Z',
  checkOutAt: '2026-09-17T21:48:00Z',
  payrollExported: false,
};

describe('Shifts tab violation log (§9.6 = §9.5)', () => {
  const shifts: ShiftRow[] = [];

  it('highlights an unresolved entry coral, makes the row open the window, and offers Resolve', () => {
    const html = renderToStaticMarkup(
      <Shifts
        shifts={shifts}
        violations={[VIOLATION, { ...VIOLATION, id: 'v2', resolved: true }]}
        details={[DETAIL, { ...DETAIL, id: 'v2', resolved: true }]}
      />,
    );
    expect(html).toContain('class="violation clickable" tabindex="0"');
    expect(html).toContain('class="clickable" style="opacity:0.6" tabindex="0"');
    expect(html).toContain('Details / Resolve');
    expect(count(html, '>Details<')).toBe(1);
  });

  it('keeps the coral bar but no window when the detail read failed', () => {
    const html = renderToStaticMarkup(<Shifts shifts={shifts} violations={[VIOLATION]} />);
    expect(html).toContain('class="violation"');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('Details');
  });
});
