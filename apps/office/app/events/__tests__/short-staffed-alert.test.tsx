// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ListedEvent } from '../data';
import {
  bucketByDay,
  isShortStaffed,
  monthCellModel,
  popupEvent,
  toEventRow,
  toEventRows,
} from '../view-model';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ListView, WeekView, DayView } = await import('../_components/EventViews');
const { MonthCellEvents } = await import('../_components/MonthCellEvents');

/**
 * ADR-0131: on the Scheduling screen, a shift that is not 100% filled — and
 * has not ended — flashes red until it fills.
 */
const DATE = '2026-10-13';
const before = new Date('2026-10-06T09:00:00Z');
const during = new Date('2026-10-13T12:00:00Z');
const after = new Date('2026-10-14T12:00:00Z');

function ev(id: string, confirmed: number, over: Partial<ListedEvent> = {}): ListedEvent {
  return {
    id,
    title: `Event ${id}`,
    date: DATE,
    clientId: 'c',
    clientName: 'Client',
    venueName: 'Venue',
    venueAddress: '',
    poNumber: '',
    cancelledAt: null,
    cancelReason: '',
    roles: [
      { roleName: 'Chef', start: '08:00', end: '16:00', headcount: 2, buffer: 0, confirmed: 2 },
      {
        roleName: 'Waiting Staff',
        start: '09:00',
        end: '17:00',
        headcount: 4,
        buffer: 1,
        confirmed,
      },
    ],
    ...over,
  };
}

describe('which events raise the alert', () => {
  it('an upcoming event short by even one person', () => {
    expect(isShortStaffed(toEventRow(ev('a', 3), before))).toBe(true);
  });

  it('an ongoing event that is still short', () => {
    const row = toEventRow(ev('a', 3), during);
    expect(row.status).toBe('ongoing');
    expect(isShortStaffed(row)).toBe(true);
  });

  it('not a full event — buffer seats are not required', () => {
    expect(isShortStaffed(toEventRow(ev('a', 4), before))).toBe(false);
  });

  it('not one role over-confirmed while another is short: fill is per section', () => {
    const row = toEventRow(
      ev('a', 6, {
        roles: [
          { roleName: 'Chef', start: '08:00', end: '16:00', headcount: 2, buffer: 0, confirmed: 1 },
          {
            roleName: 'Waiting Staff',
            start: '09:00',
            end: '17:00',
            headcount: 4,
            buffer: 2,
            confirmed: 6,
          },
        ],
      }),
      before,
    );
    expect(isShortStaffed(row)).toBe(true);
  });

  it('not a cancelled event, nor one that has already ended', () => {
    expect(
      isShortStaffed(toEventRow(ev('a', 0, { cancelledAt: '2026-10-01T10:00:00Z' }), before)),
    ).toBe(false);
    expect(isShortStaffed(toEventRow(ev('a', 0), after))).toBe(false);
  });
});

describe('every view draws it', () => {
  const rows = toEventRows([ev('short', 1), ev('full', 4)], before);

  it('List: the short event’s fill pill is red and flashing, the full one green', () => {
    const html = renderToStaticMarkup(<ListView rows={rows} today="2026-10-06" />);
    expect(html.match(/fill-alert/g)).toHaveLength(1);
    expect(html).toMatch(/class="pill coral fill-alert"[^>]*>3 of 6</);
    expect(html).toMatch(/class="pill green"[^>]*>6 of 6</);
  });

  it('Day: the same pill', () => {
    const html = renderToStaticMarkup(<DayView rows={rows} />);
    expect(html.match(/pill coral fill-alert/g)).toHaveLength(1);
  });

  it('Week: the short card carries the alert class, the full one does not', () => {
    const html = renderToStaticMarkup(
      <WeekView days={[DATE]} buckets={bucketByDay(rows, [DATE])} today="2026-10-06" />,
    );
    expect(html).toMatch(/href="\/events\/short" class="wchip alert"/);
    expect(html).toMatch(/href="\/events\/full" class="wchip full"/);
  });

  it('Month: the chip and its popup row carry it', () => {
    const model = monthCellModel(rows);
    expect(model.chips.map((chip) => chip.alert)).toEqual([true, false]);
    expect(model.events.map((event) => event.tone)).toEqual(['coral', 'green']);
    const html = renderToStaticMarkup(
      <MonthCellEvents model={model} heading="Tue 13 October" dayHref={null} />,
    );
    expect(html).toMatch(/href="\/events\/short" class="evchip alert"/);
    expect(html).toMatch(/href="\/events\/full" class="evchip full"/);
  });

  it('Month: a collapsed group flashes when any event in it is short', () => {
    const group = toEventRows(
      [ev('x', 4, { title: 'Breakfast' }), ev('y', 2, { title: 'Breakfast' })],
      before,
    );
    const [chip] = monthCellModel(group).chips;
    expect(chip!.alert).toBe(true);
    expect(chip!.full).toBe(false);
  });

  it('a short ongoing event still flashes in the popup', () => {
    const [row] = toEventRows([ev('a', 0)], during);
    expect(popupEvent(row!).tone).toBe('coral');
  });
});
