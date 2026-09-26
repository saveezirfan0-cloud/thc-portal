import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * §1.8 on the shift cards (wireframes/staff/shifts.html): one prefix —
 * "Today", "Tomorrow", "Sat 20" — then the UK window, never a date on each
 * end; and the "your time" line only when the viewer's zone differs.
 */
const zone = vi.hoisted(() => ({ value: 'Europe/London' }));
vi.mock('../useViewerZone', () => ({ useViewerZone: () => zone.value }));

const { ShiftTime, dayPrefix, yourTimeLine } = await import('../ShiftTime');

// A September evening, BST: 17:00–23:30 UK on Saturday 19 September 2026.
const start = new Date('2026-09-19T16:00:00Z');
const end = new Date('2026-09-19T22:30:00Z');

describe('dayPrefix', () => {
  it('is Today / Tomorrow relative to the UK calendar, else the weekday and day', () => {
    expect(dayPrefix(start, new Date('2026-09-19T08:00:00Z'))).toBe('Today');
    expect(dayPrefix(start, new Date('2026-09-18T08:00:00Z'))).toBe('Tomorrow');
    expect(dayPrefix(start, new Date('2026-09-10T08:00:00Z'))).toBe('Sat 19');
  });

  it('adds the month on request, for dates too far out for the day alone', () => {
    expect(dayPrefix(start, new Date('2026-08-10T08:00:00Z'), true)).toBe('Sat 19 Sep');
    // Relative words win: "Tomorrow" never becomes a date.
    expect(dayPrefix(start, new Date('2026-09-18T08:00:00Z'), true)).toBe('Tomorrow');
  });

  it('reads the day in London: 00:30 BST is already "today" while UTC still says yesterday', () => {
    const justAfterMidnightUk = new Date('2026-09-18T23:30:00Z'); // 00:30 BST, 19 Sept
    expect(dayPrefix(start, justAfterMidnightUk)).toBe('Today');
  });
});

describe('<ShiftTime withDate>', () => {
  it('prints one prefix and the window, in UK time', () => {
    const html = renderToStaticMarkup(
      <ShiftTime startsAt={start} endsAt={end} withDate now={new Date('2026-09-18T08:00:00Z')} />,
    );
    expect(html).toContain('Tomorrow · 17:00 – 23:30');
    expect(html).not.toContain('19 Sept, 17:00');
    expect(html).not.toContain('(UK)');
    expect(html).not.toContain('your time');
  });

  it('adds "(UK)" and the second line for a viewer abroad', () => {
    zone.value = 'Europe/Madrid';
    const html = renderToStaticMarkup(
      <ShiftTime startsAt={start} endsAt={end} withDate now={new Date('2026-09-10T08:00:00Z')} />,
    );
    expect(html).toContain('Sat 19 · 17:00 – 23:30 (UK)');
    // The compact line: the viewer's window once, "your time" once, no date
    // (Madrid is still on Saturday 19th).
    expect(html).toContain('18:00 – 00:30 your time');
    expect(html.match(/your time/g)).toHaveLength(1);
    expect(html).not.toContain('19 Sep, 18:00');
    zone.value = 'Europe/London';
  });

  it('without a date is the plain window, as before', () => {
    const html = renderToStaticMarkup(<ShiftTime startsAt={start} endsAt={end} />);
    expect(html).toContain('17:00 – 23:30');
    expect(html).not.toContain('·');
  });

  it('without a date, a viewer abroad reads one "(UK)", not one per end', () => {
    zone.value = 'Asia/Tashkent';
    const html = renderToStaticMarkup(<ShiftTime startsAt={start} endsAt={end} />);
    expect(html).toContain('17:00 – 23:30 (UK)');
    expect(html.match(/\(UK\)/g)).toHaveLength(1);
    zone.value = 'Europe/London';
  });
});

describe('yourTimeLine — the §1.8 second line, compact', () => {
  // The screenshot: Fri 11 Sep, 11:00–16:00 UK, viewer on UTC+5.
  const fri = new Date('2026-09-11T10:00:00Z');
  const friEnd = new Date('2026-09-11T15:00:00Z');

  it('is null on UK time — no second line at all', () => {
    expect(yourTimeLine(fri, friEnd, 'Europe/London')).toBeNull();
  });

  it('is the window once with "your time" once, no date when the day matches', () => {
    expect(yourTimeLine(fri, friEnd, 'Asia/Tashkent')).toBe('15:00 – 20:00 your time');
  });

  it('leads with the viewer-local date only when their start day differs from the UK day', () => {
    // 17:00–23:30 UK on Sat 19 is 01:00–07:30 on Sun 20 in Tokyo.
    expect(yourTimeLine(start, end, 'Asia/Tokyo')).toBe('Sun 20 · 01:00 – 07:30 your time');
    // A day earlier to the west: 02:00 UK on Sat 19 is 21:00 on Fri 18 in New York.
    const early = new Date('2026-09-19T01:00:00Z');
    expect(yourTimeLine(early, new Date('2026-09-19T07:00:00Z'), 'America/New_York')).toBe(
      'Fri 18 · 21:00 – 03:00 your time',
    );
  });

  it('an overnight window that crosses midnight only locally carries no second date', () => {
    // 17:00–23:30 UK is 19:00–01:30 in Athens: same start day, so no date.
    expect(yourTimeLine(start, end, 'Europe/Athens')).toBe('19:00 – 01:30 your time');
  });
});
