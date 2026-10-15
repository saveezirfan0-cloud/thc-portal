// @vitest-environment jsdom
/**
 * ADR-0142: a shift total per day and per week on the Week and Day views,
 * and the busiest day and week ever booked recognised with a flash-up.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListedEvent } from '../data';
import {
  bucketByDay,
  formatShifts,
  heldRecord,
  parseShiftRecords,
  recordNews,
  recordsInPeriod,
  rowShifts,
  toEventRows,
  totalShifts,
} from '../view-model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DayView, WeekView } = await import('../_components/EventViews');
const { RecordFlash, SEEN_RECORDS_KEY } = await import('../_components/RecordFlash');

const before = new Date('2026-10-06T09:00:00Z');
// Mon 12 – Sun 18 Oct 2026.
const WEEK = ['12', '13', '14', '15', '16', '17', '18'].map((d) => `2026-10-${d}`);

function ev(id: string, date: string, headcount: number, over: Partial<ListedEvent> = {}) {
  return {
    id,
    title: `Event ${id}`,
    date,
    clientId: 'c',
    clientName: 'Client',
    venueName: 'Venue',
    venueAddress: '',
    poNumber: '',
    cancelledAt: null,
    cancelReason: '',
    roles: [
      {
        roleName: 'Waiting Staff',
        start: '09:00',
        end: '17:00',
        headcount,
        buffer: 2,
        confirmed: 1,
      },
      {
        roleName: 'Bar Staff',
        start: '12:00',
        end: '20:00',
        headcount: 3,
        buffer: 1,
        confirmed: 0,
      },
    ],
    ...over,
  } satisfies ListedEvent;
}

describe('shifts (ADR-0142)', () => {
  const rows = toEventRows(
    [
      ev('a', WEEK[0]!, 10),
      ev('b', WEEK[0]!, 5),
      ev('c', WEEK[2]!, 7),
      ev('x', WEEK[2]!, 99, { cancelledAt: '2026-10-01T10:00:00Z' }),
    ],
    before,
  );

  it('is the headcount of every role section — never the buffer, never a cancelled event', () => {
    expect(rows.map(rowShifts)).toEqual([13, 8, 10, 0]);
    expect(totalShifts(rows)).toBe(31);
  });

  it('is totalled per day in the buckets', () => {
    const buckets = bucketByDay(rows, WEEK);
    expect(buckets.get(WEEK[0]!)?.shifts).toBe(21);
    expect(buckets.get(WEEK[2]!)?.shifts).toBe(10);
    expect(buckets.get(WEEK[1]!)?.shifts).toBe(0);
  });

  it('reads "1 shift" and "1,240 shifts"', () => {
    expect(formatShifts(1)).toBe('1 shift');
    expect(formatShifts(0)).toBe('0 shifts');
    expect(formatShifts(1240)).toBe('1,240 shifts');
  });

  it('prints each day in its week column and the week total above', () => {
    const live = rows.filter((r) => r.status !== 'cancelled');
    const html = renderToStaticMarkup(
      <WeekView days={WEEK} buckets={bucketByDay(live, WEEK)} today="2026-10-06" />,
    );
    expect(html).toContain('This week');
    expect(html).toContain('31 shifts');
    expect(html).toContain('across 3 events');
    expect(html.match(/<span class="s">/g)).toHaveLength(7);
    expect(html).toContain('<span class="s">21 shifts</span>');
    expect(html).toContain('<span class="s">0 shifts</span>');
  });

  it('prints the day total on the Day view', () => {
    const html = renderToStaticMarkup(<DayView rows={rows.slice(0, 2)} />);
    expect(html).toContain('This day');
    expect(html).toContain('21 shifts');
    expect(html).toContain('across 2 events');
  });
});

describe('records (ADR-0142)', () => {
  const records = parseShiftRecords({
    days: [
      { date: WEEK[5], shifts: 312 },
      { date: '2026-10-03', shifts: 280 },
    ],
    weeks: [
      { date: WEEK[0], shifts: 1240 },
      { date: '2026-09-28', shifts: 1100 },
    ],
  });

  it('reads the RPC defensively', () => {
    expect(parseShiftRecords(null)).toEqual({ days: [], weeks: [] });
    expect(
      parseShiftRecords({ days: [{ date: 'nope', shifts: 3 }, { date: '2026-10-01' }] }),
    ).toEqual({ days: [], weeks: [] });
  });

  it('is held by the top of the table only, and only when it beat something', () => {
    expect(heldRecord(records, 'day', WEEK[5]!)?.shifts).toBe(312);
    expect(heldRecord(records, 'day', '2026-10-03')).toBeNull();
    expect(
      heldRecord(parseShiftRecords({ days: [{ date: WEEK[5], shifts: 9 }] }), 'day', WEEK[5]!),
    ).toBeNull();
  });

  it('a week holds its own record and the busiest day inside it, week first', () => {
    expect(recordsInPeriod(records, 'week', WEEK).map((r) => r.key)).toEqual([
      `week:${WEEK[0]}`,
      `day:${WEEK[5]}`,
    ]);
    expect(recordsInPeriod(records, 'day', [WEEK[5]!]).map((r) => r.key)).toEqual([
      `day:${WEEK[5]}`,
    ]);
    expect(recordsInPeriod(records, 'day', [WEEK[4]!])).toEqual([]);
  });

  it('says what was beaten, or that a tie was got to first', () => {
    const [week, day] = recordsInPeriod(records, 'week', WEEK).map(recordNews);
    expect(week).toMatchObject({
      badge: 'Record week',
      headline: '1,240 shifts in the week of Mon 12 Oct — the most ever booked in one week.',
      detail: 'Beating the previous best of 1,100 in the week of Mon 28 Sep.',
    });
    expect(day).toMatchObject({
      badge: 'Record day',
      headline: '312 shifts on Sat 17 Oct — the busiest day ever booked.',
      detail: 'Beating the previous best of 280 on Sat 3 Oct.',
    });
    const tie = parseShiftRecords({
      days: [
        { date: '2026-10-03', shifts: 280 },
        { date: WEEK[5], shifts: 280 },
      ],
    });
    expect(recordNews(heldRecord(tie, 'day', '2026-10-03')!).detail).toBe(
      'Equalled by Sat 17 Oct — but this one got there first.',
    );
  });

  it('marks the record day in its week column', () => {
    const html = renderToStaticMarkup(
      <WeekView
        days={WEEK}
        buckets={bucketByDay([], WEEK)}
        today="2026-10-06"
        recordDay={WEEK[5]!}
      />,
    );
    expect(html.match(/class="col record"/g)).toHaveLength(1);
    expect(html).toContain(' · record');
  });
});

describe('the flash-up (ADR-0142)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const news = [
    {
      key: 'week:2026-10-12',
      badge: 'Record week',
      headline: '1,240 shifts in the week of Mon 12 Oct — the most ever booked in one week.',
      detail: 'Beating the previous best of 1,100 in the week of Mon 28 Sep.',
    },
  ];
  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const press = (el: Element) =>
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

  it('flashes up the first time, with confetti, and not again once closed', () => {
    act(() => root.render(<RecordFlash records={news} />));
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Congratulations!');
    expect(dialog.textContent).toContain('the most ever booked in one week');
    expect(container.querySelector('.record-confetti')).not.toBeNull();

    press([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Brilliant')!);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SEEN_RECORDS_KEY)!)).toEqual([news[0]!.key]);

    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<RecordFlash records={news} />));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // The badge stays, and opens the message again.
    press(container.querySelector('button.record-badge')!);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('draws nothing without a record', () => {
    act(() => root.render(<RecordFlash records={[]} />));
    expect(container.innerHTML).toBe('');
  });
});
