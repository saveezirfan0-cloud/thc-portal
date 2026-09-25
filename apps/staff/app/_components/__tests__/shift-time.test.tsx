import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * §1.8 on the shift cards (wireframes/staff/shifts.html): one prefix —
 * "Today", "Tomorrow", "Sat 20" — then the UK window, never a date on each
 * end; and the "your time" line only when the viewer's zone differs.
 */
const zone = vi.hoisted(() => ({ value: 'Europe/London' }));
vi.mock('../useViewerZone', () => ({ useViewerZone: () => zone.value }));

const { ShiftTime, dayPrefix } = await import('../ShiftTime');

// A September evening, BST: 17:00–23:30 UK on Saturday 19 September 2026.
const start = new Date('2026-09-19T16:00:00Z');
const end = new Date('2026-09-19T22:30:00Z');

describe('dayPrefix', () => {
  it('is Today / Tomorrow relative to the UK calendar, else the weekday and day', () => {
    expect(dayPrefix(start, new Date('2026-09-19T08:00:00Z'))).toBe('Today');
    expect(dayPrefix(start, new Date('2026-09-18T08:00:00Z'))).toBe('Tomorrow');
    expect(dayPrefix(start, new Date('2026-09-10T08:00:00Z'))).toBe('Sat 19');
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
    expect(html).toContain('your time');
    zone.value = 'Europe/London';
  });

  it('without a date is the plain window, as before', () => {
    const html = renderToStaticMarkup(<ShiftTime startsAt={start} endsAt={end} />);
    expect(html).toContain('17:00 – 23:30');
    expect(html).not.toContain('·');
  });
});
