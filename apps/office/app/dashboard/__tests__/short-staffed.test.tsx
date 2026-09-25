import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  type ShortStaffedRow,
  confirmedOf,
  shortStaffedSummary,
  toShortStaffed,
  totalOpen,
} from '../short-staffed';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ShortStaffedPanel } = await import('../_components/ShortStaffedPanel');
const { ScheduledStart } = await import('../_components/ScheduledStart');

function row(overrides: Partial<ShortStaffedRow>): ShortStaffedRow {
  return {
    shift_id: 's-1',
    event_id: 'e-1',
    event_title: 'Autumn Gala',
    event_date: '2026-09-25',
    client_name: 'Savoy Events',
    venue_name: 'The Savoy',
    role_name: 'Waiting Staff',
    starts_at: '2026-09-25T17:00:00Z',
    ends_at: '2026-09-25T22:30:00Z',
    headcount: 12,
    confirmed: 9,
    open_positions: 3,
    ...overrides,
  };
}

const ROWS: ShortStaffedRow[] = [
  row({
    shift_id: 's-3',
    role_name: 'Bar',
    starts_at: '2026-09-26T10:00:00Z',
    headcount: 6,
    confirmed: 5,
    open_positions: 1,
  }),
  row({
    shift_id: 's-2',
    role_name: 'Chef',
    starts_at: '2026-09-25T17:00:00Z',
    headcount: 2,
    confirmed: 0,
    open_positions: 2,
  }),
  row({ shift_id: 's-1' }),
];

describe('shaping the short-staffed rows', () => {
  it('orders by the role section start, then event, then role', () => {
    const roles = toShortStaffed(ROWS);
    expect(roles.map((r) => r.shiftId)).toEqual(['s-2', 's-1', 's-3']);
  });

  it('reads fill as confirmed of headcount — never headcount + buffer', () => {
    expect(confirmedOf({ confirmed: 9, headcount: 12 })).toBe('9 of 12');
  });

  it('sums the open positions and summarises the panel', () => {
    const roles = toShortStaffed(ROWS);
    expect(totalOpen(roles)).toBe(6);
    expect(shortStaffedSummary(roles)).toBe('3 roles · 6 open');
    expect(shortStaffedSummary(roles.slice(0, 1))).toBe('1 role · 2 open');
    expect(shortStaffedSummary([])).toBe('All filled');
  });
});

describe('the panel', () => {
  it('lists each role with its start, fill, open count and a link to the board', () => {
    const html = renderToStaticMarkup(
      <ShortStaffedPanel roles={toShortStaffed(ROWS)} problem={null} />,
    );
    expect(html).toContain('Short-staffed');
    expect(html).toContain('next 48 hours');
    expect(html).toContain('Starts (UK time)');
    expect(html).toContain('9 of 12');
    expect(html).toContain('0 of 2');
    expect(html).toContain('3 open');
    expect(html).toMatch(/<a[^>]*href="\/events\/e-1"[^>]*>Open board →<\/a>/);
    // 18:00 BST on Fri 25 Sep for 17:00Z.
    expect(html).toContain('Fri 25 Sep · 18:00');
  });

  it('shows no money and never folds the buffer into the headcount', () => {
    const html = renderToStaticMarkup(
      <ShortStaffedPanel roles={toShortStaffed(ROWS)} problem={null} />,
    );
    expect(html).not.toMatch(/£|margin|charge|\/h\b/i);
    expect(html).not.toMatch(/\(\+\d+\)/);
  });

  it('has an empty state when everything is filled', () => {
    const html = renderToStaticMarkup(<ShortStaffedPanel roles={[]} problem={null} />);
    expect(html).toContain('All filled');
    expect(html).toContain('has its headcount confirmed');
    expect(html).not.toContain('<table');
  });

  it('says so when the read failed, rather than claiming all is filled', () => {
    const html = renderToStaticMarkup(<ShortStaffedPanel roles={null} problem="boom" />);
    expect(html).toContain('boom');
    expect(html).not.toContain('All filled');
  });

  it('keeps clear of the ten-day list the e2e suite reads', () => {
    const html = renderToStaticMarkup(
      <ShortStaffedPanel roles={toShortStaffed(ROWS)} problem={null} />,
    );
    expect(html).not.toContain('dash-roles');
    expect(html).not.toContain('Upcoming events');
    expect(html).not.toContain('Window (UK time)');
    expect(html).not.toMatch(/§|RULE-/);
  });
});

describe('ScheduledStart (UK + your time)', () => {
  it('is UK-only for a reader in London', () => {
    const html = renderToStaticMarkup(
      <ScheduledStart startsAt="2026-09-26T00:30:00Z" zone="Europe/London" />,
    );
    expect(html).toContain('Sat 26 Sep · 01:30');
    expect(html).not.toContain('your time');
  });

  it('adds a your-time line, with its own day, elsewhere', () => {
    const html = renderToStaticMarkup(
      <ScheduledStart startsAt="2026-09-26T00:30:00Z" zone="America/New_York" />,
    );
    expect(html).toContain('Sat 26 Sep · 01:30 UK time');
    expect(html).toContain('Fri 25 Sep · 20:30 your time');
  });
});
