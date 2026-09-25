import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StaffProfile } from '../types';

/**
 * The Profile tab — ADR-0035.
 *
 * Documents left the bottom navigation for this screen, so what this pins
 * is that it arrived: a Documents row, first, carrying the same verdict
 * lock case 1 acts on — never "Up to date" on a worker whose Shifts are
 * closed. And that the way to edit the profile is a button under the name,
 * not a guess.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({ requestP45: vi.fn() }));

const { ProfileHub, documentsStatus } = await import('../_components/ProfileHub');

const worker = (over: Partial<StaffProfile> = {}): StaffProfile => ({
  staffId: 's1',
  firstName: 'Amara',
  lastName: 'Kalu',
  employeeId: 417,
  email: 'amara@example.test',
  phone: '+447700900123',
  homeAddress: null,
  photoPath: null,
  photoLocked: true,
  status: 'compliant',
  blockKind: null,
  leftAt: null,
  rtwBranch: 'uk_irish',
  niMasked: null,
  hasNiNumber: true,
  rating: 4.6,
  reliability: 96,
  quizAttempts: 1,
  roles: ['Waiting Staff'],
  blockers: [],
  checkedIn: false,
  bank: null,
  ...over,
});

const render = (profile: StaffProfile) =>
  renderToStaticMarkup(<ProfileHub profile={profile} photoUrl={null} futureShifts={0} />);

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe('the Profile tab (ADR-0035)', () => {
  it('opens with Edit profile, then Documents first in the list', () => {
    const html = render(worker());
    expect(hrefs(html)).toEqual([
      '/profile/details', // Edit profile
      '/documents',
      '/profile/details',
      '/profile/payments',
      '/profile/security',
      '/notifications',
    ]);
    expect(html).toContain('Edit profile');
  });

  it('keeps §10.1’s order below the list: sign-out, then the help line as text', () => {
    const html = render(worker());
    expect(html.indexOf('hub-list')).toBeLessThan(html.indexOf('Sign out'));
    expect(html.indexOf('Sign out')).toBeLessThan(html.indexOf('Need help?'));
    expect(html).not.toContain('href="mailto:');
  });

  it('is a screen now, not a modal over another one', () => {
    const html = render(worker());
    expect(html).not.toContain('sheet-back');
    expect(html).not.toContain('aria-modal');
  });

  it('shows a document-blocked worker the way out, marked Action needed', () => {
    const html = render(worker({ blockers: ['document_expired:passport'] }));
    expect(hrefs(html)).toContain('/documents');
    expect(html).toContain('Action needed');
    expect(html).not.toContain('Up to date');
  });

  it('gives a candidate still in the wizard neither Documents nor Edit profile', () => {
    const html = render(worker({ status: 'documents', employeeId: null }));
    expect(hrefs(html)).not.toContain('/documents');
    expect(html).not.toContain('Edit profile');
  });
});

describe('documentsStatus — the badge on the Documents row', () => {
  it('is Up to date for a compliant worker with nothing outstanding', () => {
    expect(documentsStatus(worker())).toEqual({ tone: 'green', text: 'Up to date' });
  });

  it('is Action needed when an expired document has closed Shifts (§10.1 case 1)', () => {
    expect(documentsStatus(worker({ blockers: ['document_expired:right_to_work'] }))).toEqual({
      tone: 'coral',
      text: 'Action needed',
    });
    expect(documentsStatus(worker({ status: 'blocked', blockKind: 'auto_document' }))).toEqual({
      tone: 'coral',
      text: 'Action needed',
    });
  });

  it('is In review — not Action needed — while a declaration is reviewed (§10.7)', () => {
    expect(documentsStatus(worker({ status: 'blocked', blockKind: 'conviction_review' }))).toEqual({
      tone: 'amber',
      text: 'In review',
    });
  });

  it('is In review for a replacement waiting on the office while the old one counts', () => {
    expect(documentsStatus(worker({ blockers: ['document_unverified:passport'] }))).toEqual({
      tone: 'amber',
      text: 'In review',
    });
  });

  it('says nothing for a lock with no Documents behind it', () => {
    expect(documentsStatus(worker({ status: 'blocked', blockKind: 'manual' }))).toBeNull();
    expect(documentsStatus(worker({ status: 'inactive' }))).toBeNull();
  });
});

describe('the two sub-lines: next pay and a document expiring', () => {
  const renderWith = (extra: Partial<Parameters<typeof ProfileHub>[0]>) =>
    renderToStaticMarkup(
      <ProfileHub profile={worker()} photoUrl={null} futureShifts={0} {...extra} />,
    );

  it('puts "Next pay" on the Payment information row, and hides it when nothing is owed', () => {
    const owed = renderWith({ nextPay: { payDate: '2026-10-02', totalPence: 12345 } });
    expect(owed).toContain('Next pay Fri 2 Oct · £123.45');
    expect(owed).not.toContain('Earnings history, bank details');

    const none = renderWith({ nextPay: null });
    expect(none).not.toContain('Next pay');
    expect(none).toContain('Earnings history, bank details');
  });

  it('puts an amber expiry on the Documents row', () => {
    const html = renderWith({
      expiring: { docType: 'passport', label: 'Passport', days: 12, expiresOn: '2026-10-05' },
    });
    expect(html).toContain('<span class="s amber">Passport expires in 12 days</span>');
    expect(html).not.toContain('Right to work, ID, declarations');
  });
});
