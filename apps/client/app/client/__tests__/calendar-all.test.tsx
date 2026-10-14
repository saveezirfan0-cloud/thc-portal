import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarAllButton } from '../CalendarAllButton';
import { ICS_UID_DOMAIN, buildCalendar, buildIcs, upcomingForCalendar } from '../ics';
import type { PortalEvent } from '../rules';

/**
 * "Add all upcoming to calendar" (ADR-0134 N7): one file, one VEVENT per
 * not-cancelled event that has not ended, each exactly as ADR-0050 writes a
 * single event — the same UID, so a re-import updates rather than doubles —
 * and still no worker names and no money.
 */
const ev = (id: string, over: Partial<PortalEvent> = {}): PortalEvent => ({
  id,
  title: `Event ${id}`,
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventDate: '2026-10-20',
  poNumber: '4471-A',
  onsiteContact: 'Marco Vitale · 07700 900123',
  startsAt: '2026-10-20T16:00:00Z',
  endsAt: '2026-10-20T22:30:00Z',
  status: 'upcoming',
  ...over,
});

const NOW = new Date('2026-10-14T09:00:00Z');
const STAMP = new Date('2026-10-14T09:05:00Z');
const url = (id: string) => `https://portal.example/client/events/${id}`;

describe('which events', () => {
  it('every one not ended and not cancelled, soonest first — a running one included', () => {
    const events = [
      ev('later', { startsAt: '2026-10-22T16:00:00Z', endsAt: '2026-10-22T22:00:00Z' }),
      ev('off', { status: 'cancelled' }),
      ev('past', {
        status: 'completed',
        startsAt: '2026-10-10T16:00:00Z',
        endsAt: '2026-10-10T22:00:00Z',
      }),
      ev('now', {
        status: 'ongoing',
        startsAt: '2026-10-14T07:00:00Z',
        endsAt: '2026-10-14T15:00:00Z',
      }),
      ev('soon'),
    ];
    expect(upcomingForCalendar(events, NOW).map((e) => e.id)).toEqual(['now', 'soon', 'later']);
  });
});

describe('the file', () => {
  const a = ev('a');
  const b = ev('b', { title: 'Wedding, Garden; Party', startsAt: '2026-10-25T11:00:00Z' });
  const file = buildCalendar([a, b], { lineupUrl: url, stampedAt: STAMP });

  it('is one VCALENDAR with a VEVENT per event', () => {
    expect(file.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(file).not.toMatch(/[^\r]\n/);
  });

  it('keeps ADR-0050’s UID, so it updates the entries a single download made', () => {
    expect(file).toContain(`UID:a@${ICS_UID_DOMAIN}`);
    expect(file).toContain(`UID:b@${ICS_UID_DOMAIN}`);
    // Each VEVENT is byte for byte the single event's.
    const single = buildIcs(a, { lineupUrl: url('a'), stampedAt: STAMP });
    const vevent = (text: string) =>
      text.slice(text.indexOf('BEGIN:VEVENT'), text.indexOf('END:VEVENT'));
    expect(vevent(file)).toBe(vevent(single));
    expect(file).toContain('SUMMARY:Wedding\\, Garden\\; Party');
    // Content lines fold at 75 octets (RFC 5545 §3.1); unfolded, the link is whole.
    expect(file.replace(/\r\n /g, '')).toContain('Line-up: https://portal.example/client/events/b');
  });

  it('carries no worker, no on-site contact and no money', () => {
    expect(file).not.toContain('Marco');
    expect(file).not.toContain('07700');
    expect(file).not.toMatch(/£|rate|charge/i);
  });
});

describe('the button', () => {
  it('is drawn when something is ahead, and not otherwise', () => {
    const html = renderToStaticMarkup(
      <CalendarAllButton events={[ev('a'), ev('b')]} now={NOW.toISOString()} />,
    );
    expect(html).toContain('Add all upcoming to calendar');
    expect(html).toContain('title="One calendar file with all 2 of your upcoming events"');
    expect(
      renderToStaticMarkup(
        <CalendarAllButton events={[ev('x', { status: 'cancelled' })]} now={NOW.toISOString()} />,
      ),
    ).toBe('');
  });
});
