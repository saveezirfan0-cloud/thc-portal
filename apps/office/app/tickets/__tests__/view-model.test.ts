import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatHours,
  formatMinutes,
  ilikePattern,
  isOutsideScope,
  monthLabel,
  monthOf,
  monthRange,
  parseDuration,
  parseMonth,
  shiftMonth,
  summariseTime,
  timeCsv,
  isOpen,
  parseQuery,
  ticketNumberOf,
  ticketRef,
  ticketsHref,
  validateDraft,
} from '../view-model';

const draft = { kind: 'bug', severity: '', title: 'Card vanishes', details: '', link: '' };

describe('ticket references', () => {
  it('writes the id the team quotes', () => {
    expect(ticketRef(12)).toBe('TK-12');
  });

  it('reads a search as a ticket number only when it is one', () => {
    expect(ticketNumberOf('TK-12')).toBe(12);
    expect(ticketNumberOf('tk12')).toBe(12);
    expect(ticketNumberOf(' 7 ')).toBe(7);
    expect(ticketNumberOf('kanban 7')).toBeNull();
    expect(ticketNumberOf('')).toBeNull();
  });

  it('counts New, In progress and Waiting as open', () => {
    expect(['new', 'in_progress', 'waiting'].map((s) => isOpen(s as 'new'))).toEqual([
      true,
      true,
      true,
    ]);
    expect(isOpen('resolved')).toBe(false);
    expect(isOpen('closed')).toBe(false);
  });
});

describe('validateDraft — the same rules create_ticket() holds', () => {
  it('lets a plain report through, severity and link optional', () => {
    expect(validateDraft(draft)).toBeNull();
    expect(
      validateDraft({ ...draft, severity: 'high', link: 'https://www.loom.com/share/abc' }),
    ).toBeNull();
  });

  it('wants a kind from the list', () => {
    expect(validateDraft({ ...draft, kind: 'rant' })).toMatch(/kind/);
  });

  it('wants a summary of 3 to 200 characters', () => {
    expect(validateDraft({ ...draft, title: '  a ' })).toMatch(/summary is required/);
    expect(validateDraft({ ...draft, title: 'x'.repeat(201) })).toMatch(/at most 200/);
  });

  it('caps the details at 5,000', () => {
    expect(validateDraft({ ...draft, details: 'x'.repeat(5001) })).toMatch(/5,000/);
  });

  it('refuses a severity off the list and a link that is not http(s)', () => {
    expect(validateDraft({ ...draft, severity: 'meh' })).toMatch(/how bad/);
    expect(validateDraft({ ...draft, link: 'javascript:alert(1)' })).toMatch(/https:\/\//);
    expect(validateDraft({ ...draft, link: 'https://a b' })).toMatch(/https:\/\//);
  });
});

describe('the list address', () => {
  it('defaults to the Open tab, first page, no filters', () => {
    expect(parseQuery({})).toEqual({
      tab: 'open',
      q: '',
      kind: null,
      severity: null,
      status: null,
      scope: null,
      page: 1,
    });
  });

  it('drops anything it does not recognise instead of trusting it', () => {
    const query = parseQuery({
      tab: 'everything',
      kind: 'rant',
      severity: 'meh',
      status: 'lost',
      scope: 'huge',
      page: '-3',
    });
    expect(query).toMatchObject({
      tab: 'open',
      kind: null,
      severity: null,
      status: null,
      scope: null,
      page: 1,
    });
  });

  it('round-trips a query, leaving defaults out', () => {
    const query = parseQuery({ tab: 'closed', q: 'kanban', kind: 'bug', page: '2' });
    expect(ticketsHref(query)).toBe('/tickets?tab=closed&q=kanban&kind=bug&page=2');
    expect(ticketsHref({ tab: 'open' })).toBe('/tickets');
  });

  it('escapes a search for ilike and strips the or() grammar', () => {
    expect(ilikePattern('50%_off')).toBe('%50\\%\\_off%');
    expect(ilikePattern('a,b(c)')).toBe('%a b c%');
  });
});

describe('parsing a time', () => {
  it('reads the ways a person types it', () => {
    expect(parseDuration('15')).toBe(15);
    expect(parseDuration('15m')).toBe(15);
    expect(parseDuration('15 mins')).toBe(15);
    expect(parseDuration('1h')).toBe(60);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1h30')).toBe(90);
    expect(parseDuration('1.5h')).toBe(90);
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('  2 hours  ')).toBe(120);
    expect(parseDuration('24h')).toBe(1440);
  });

  it('refuses what is not a time, zero, and more than a day', () => {
    for (const bad of ['', 'abc', '0', '0m', '-5', '25h', '1441', '1:75x', 'h', '1h 30x']) {
      expect(parseDuration(bad), bad).toBeNull();
    }
  });

  it('writes a time back the way it reads', () => {
    expect(formatMinutes(5)).toBe('5m');
    expect(formatMinutes(65)).toBe('1h 05m');
    expect(formatMinutes(120)).toBe('2h');
    expect(parseDuration(formatMinutes(95))).toBe(95);
    expect(formatHours(90)).toBe('1.50');
    expect(formatClock(3725)).toBe('01:02:05');
    expect(formatClock(-4)).toBe('00:00:00');
  });
});

describe('months', () => {
  it('names a UK month, and a bad one is this month', () => {
    const now = new Date('2026-10-23T09:00:00Z');
    expect(parseMonth('2026-09', now)).toBe('2026-09');
    expect(parseMonth('2026-13', now)).toBe('2026-10');
    expect(parseMonth('soon', now)).toBe('2026-10');
    expect(parseMonth(undefined, now)).toBe('2026-10');
  });

  it('puts a late-evening BST instant in the right UK month', () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in... no: UK is on GMT from 25 Oct.
    expect(monthOf(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10');
    // 23:30 UTC on 30 Sep is 00:30 BST on 1 Oct.
    expect(monthOf(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10');
  });

  it('gives the range, steps over a year end and labels it', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-11-01' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
});

describe('the month’s bill', () => {
  const rows = [
    {
      ticketNo: 1,
      title: 'Fix',
      label: 'fix' as const,
      workedBy: 'owner' as const,
      workedOn: '2026-10-02',
      minutes: 30,
      billable: false,
      note: null,
    },
    {
      ticketNo: 2,
      title: 'Export button',
      label: 'addition' as const,
      workedBy: 'claude' as const,
      workedOn: '2026-10-03',
      minutes: 90,
      billable: true,
      note: 'after the email',
    },
    {
      ticketNo: 2,
      title: 'Export button',
      label: 'addition' as const,
      workedBy: 'owner' as const,
      workedOn: '2026-10-04',
      minutes: 15,
      billable: true,
      note: null,
    },
    {
      ticketNo: 3,
      title: 'Unlabelled',
      label: null,
      workedBy: 'owner' as const,
      workedOn: '2026-10-05',
      minutes: 10,
      billable: false,
      note: null,
    },
  ];

  it('totals billable and all time, by label, by who and by ticket', () => {
    const s = summariseTime(rows);
    expect(s.minutes).toBe(145);
    expect(s.billableMinutes).toBe(105);
    expect(s.byLabel.addition).toEqual({ minutes: 105, billableMinutes: 105 });
    expect(s.byLabel.fix).toEqual({ minutes: 30, billableMinutes: 0 });
    expect(s.byLabel.unlabelled.minutes).toBe(10);
    expect(s.byWorker).toEqual({ owner: 55, claude: 90 });
    expect(s.tickets.map((t) => [t.ticketNo, t.minutes])).toEqual([
      [2, 105],
      [1, 30],
      [3, 10],
    ]);
  });

  it('calls only the two outside labels outside the scope', () => {
    expect(isOutsideScope('against_scope')).toBe(true);
    expect(isOutsideScope('addition')).toBe(true);
    for (const l of ['fix', 'update', 'issue', null] as const)
      expect(isOutsideScope(l)).toBe(false);
  });

  it('writes the CSV one row an entry, quoting what needs it and defusing formulas', () => {
    const csv = timeCsv([
      ...rows.slice(0, 2),
      { ...rows[3]!, title: '=HYPERLINK("x")', note: 'a, "quoted" note' },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Date,Ticket,Title,Scope label,Worked by,Minutes,Hours,Billable,Note');
    expect(lines[2]).toBe(
      '2026-10-03,TK-2,Export button,Addition,Claude,90,1.50,Yes,after the email',
    );
    expect(lines[3]).toContain('"\'=HYPERLINK(""x"")"');
    expect(lines[3]).toContain('"a, ""quoted"" note"');
    expect(lines[3]).toContain('Not labelled');
  });
});
