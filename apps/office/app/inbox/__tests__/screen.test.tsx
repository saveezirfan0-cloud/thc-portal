import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { InboxFilters, InboxPageData } from '../data';
import type { InboxRow } from '../view-model';

// Outside Next there is no router and no server; neither is under test.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/inbox',
}));

const { InboxScreen } = await import('../InboxScreen');

const PERSON = 'dddddddd-0000-4000-8000-0000000000aa';

const ROW: InboxRow = {
  id: 11,
  key: `E3:staff:${PERSON}:1759999999`,
  template: 'E3',
  recipient_emails: ['sam.candidate@example.com'],
  payload: { name: 'Sam' },
  queued_at: '2026-10-05T13:30:00Z',
  staff_id: PERSON,
  recipient_name: 'Sam Candidate',
  staff_status: 'documents',
  staff_removed: false,
  sent_at: null,
  failed_at: null,
  error: null,
  attempts: 0,
};

const FILTERS: InboxFilters = {
  audience: 'people',
  q: null,
  type: null,
  status: null,
  period: '30d',
  before: null,
};

const DATA: InboxPageData = { rows: [ROW], failedInPeriod: 0, nextBefore: null, problem: null };

const render = (data: Partial<InboxPageData> = {}, filters: Partial<InboxFilters> = {}) =>
  renderToStaticMarkup(
    <InboxScreen data={{ ...DATA, ...data }} filters={{ ...FILTERS, ...filters }} />,
  );

describe('/inbox — candidates & workers (ADR-0086)', () => {
  it('offers the three views, with Candidates & workers selected', () => {
    const markup = render();
    expect(markup).toContain('Office &amp; payroll');
    expect(markup).toContain('Clients');
    expect(markup).toMatch(/aria-selected="true"[^>]*>Candidates &amp; workers/);
  });

  it('says Willo’s own invitation is not here, so its absence is not read as unsent', () => {
    expect(render()).toContain('sent by Willo, not by this system');
    expect(render({}, { audience: 'office' })).not.toContain('sent by Willo');
  });

  it('shows the type and subject, the linked recipient, their address, the UK time and status', () => {
    const markup = render();
    expect(markup).toContain('Account activation');
    expect(markup).toContain('Activate your account');
    expect(markup).toContain(`href="/onboarding/${PERSON}"`);
    expect(markup).toContain('>Sam Candidate</a>');
    expect(markup).toContain('sam.candidate@example.com');
    expect(markup).toContain('05 Oct, 14:30');
    expect(markup).toContain('Queued');
    expect(markup).toContain('Queued (UK time)');
  });

  it('searches by address or name', () => {
    const markup = render({}, { q: 'sam@' });
    expect(markup).toContain('type="search"');
    expect(markup).toContain('value="sam@"');
  });

  it('says what a failure was, and holds a send with no keys', () => {
    const failed = render({
      rows: [{ ...ROW, failed_at: '2026-10-05T14:00:00Z', error: 'Resend answered 422: bad to' }],
    });
    expect(failed).toContain('Failed');
    expect(failed).toContain('Resend answered 422: bad to');
    const held = render({
      rows: [{ ...ROW, error: 'not configured: RESEND_API_KEY is not set' }],
    });
    expect(held).toContain('Held');
    expect(held).toContain('Held — not configured');
  });

  it('never prints a link, even if one reached the row', () => {
    const markup = render({
      rows: [
        {
          ...ROW,
          payload: { name: 'Sam', link: 'https://staff.example/activate/TOKEN123' },
        },
      ],
    });
    expect(markup).not.toContain('TOKEN123');
    expect(markup).not.toContain('/activate/');
  });

  it('says nothing was sent to a searched address', () => {
    const markup = render({ rows: [] }, { q: 'nobody@example.com' });
    expect(markup).toContain('No email matches');
    expect(markup).toContain('nobody@example.com');
  });

  it('says so when a recipient matches no record', () => {
    const markup = render({
      rows: [
        {
          ...ROW,
          key: 'E2:application:1',
          staff_id: null,
          recipient_name: null,
          staff_status: null,
        },
      ],
    });
    expect(markup).toContain('No staff or candidate record has this address.');
  });

  it('keeps the office view as it was', () => {
    const markup = render(
      {
        rows: [
          {
            ...ROW,
            key: `E8:staff:${PERSON}:1`,
            template: 'E8',
            recipient_emails: ['admin@thehospitalitycompany.co.uk'],
            payload: { name: 'Ada Lovelace', employeeId: '1042' },
            recipient_name: 'Ada Lovelace',
            staff_status: 'compliant',
          },
        ],
      },
      { audience: 'office' },
    );
    expect(markup).toContain('P45 requested — Ada Lovelace, Employee ID 1042');
    expect(markup).toContain(`href="/staff/${PERSON}"`);
    expect(markup).toContain('<th>About</th>');
  });
});
