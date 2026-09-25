import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MonitorTable } from '../MonitorTable';
import type { MonitorRow } from '../types';

/**
 * The three §1.8 rules the scope calls out by name on this screen, pinned
 * on the rendered markup with a non-UK reader and a UK one:
 *
 *   WINDOW   two lines abroad ("UK time" / "your time"), one line at home;
 *   Check-in the reader's own clock, single line;
 *   Due      the reader's LOCAL clock with no suffix — the deliberate
 *            exception that "must not be 'fixed' back to UK time".
 */
const row = (over: Partial<MonitorRow> = {}): MonitorRow => ({
  bookingId: 'b1',
  staffId: 's1',
  eventId: 'e1',
  eventTitle: 'Afternoon Tea',
  roleName: 'Waiting Staff',
  staffName: 'Nadia H.',
  photoUrl: null,
  // 15:00 – 21:00 UK on a BST day.
  startsAt: '2026-09-18T14:00:00Z',
  endsAt: '2026-09-18T20:00:00Z',
  checkInAt: null,
  checkOutAt: null,
  lastFixInside: null,
  lastFixAt: null,
  breaksCount: 0,
  lastBreakAt: null,
  lateCheckOut: false,
  status: 'due',
  ...over,
});

const render = (rows: MonitorRow[], zone: string) =>
  renderToStaticMarkup(<MonitorTable rows={rows} zone={zone} />);

describe('§1.8 on the monitor table, read from Warsaw', () => {
  const zone = 'Europe/Warsaw';

  it('shows the WINDOW on two labelled lines', () => {
    const html = render([row()], zone);
    expect(html).toContain('15:00 – 21:00 UK time');
    expect(html).toContain('<span class="l2">16:00 – 22:00 your time</span>');
  });

  it('puts the Due pill in the viewer’s local time with no zone suffix', () => {
    const html = render([row()], zone);
    expect(html).toContain('Due 16:00<');
    expect(html).not.toContain('Due 15:00');
    expect(html).not.toMatch(/Due 16:00 (UK|your)/);
  });

  it('shows the check-in stamp in the viewer’s zone only, on one line', () => {
    const html = render([row({ status: 'on_shift', checkInAt: '2026-09-18T13:47:00Z' })], zone);
    expect(html).toContain('<td class="stamp">15:47</td>');
    expect(html).not.toContain('14:47');
  });

  it('shows the Checked out pill in the viewer’s zone', () => {
    const html = render(
      [
        row({
          status: 'checked_out',
          checkInAt: '2026-09-18T13:47:00Z',
          checkOutAt: '2026-09-18T20:05:00Z',
        }),
      ],
      zone,
    );
    expect(html).toContain('Checked out 22:05');
  });
});

describe('§1.8 on the monitor table, read from the UK', () => {
  const zone = 'Europe/London';

  it('renders no second WINDOW line at all', () => {
    const html = render([row()], zone);
    expect(html).toContain('15:00 – 21:00 UK time');
    expect(html).not.toContain('your time');
    expect(html).not.toContain('class="l2"');
  });

  it('shows the Due pill and the check-in stamp on the UK clock', () => {
    const html = render([row({ checkInAt: '2026-09-18T13:47:00Z' })], zone);
    expect(html).toContain('Due 15:00<');
    expect(html).toContain('<td class="stamp">14:47</td>');
  });
});

describe('§9.5 the Staff column', () => {
  it('renders the signed selfie URL, and initials when there is none', () => {
    const signed = 'https://x.supabase.co/storage/v1/object/sign/photos/s1/selfie.jpg?token=abc';
    expect(render([row({ photoUrl: signed })], 'Europe/London')).toContain(`src="${signed}"`);
    const none = render([row({ photoUrl: null })], 'Europe/London');
    expect(none).not.toContain('<img');
    expect(none).toContain('>NH<');
  });
});
