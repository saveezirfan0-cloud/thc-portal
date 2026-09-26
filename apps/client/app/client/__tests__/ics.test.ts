import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, foldLine, icsFileName, icsUtc, lineupUrlFor } from '../ics';
import type { PortalEvent } from '../rules';

/**
 * "Add to calendar" (ADR-0050): the RFC 5545 file, byte for byte where it
 * matters — TEXT escaping, 75-octet folding, CRLF, UTC stamps — and what
 * it must never carry: a worker's name or money.
 */
const EVENT_ID = '60000000-0000-4000-8000-000000000001';
const ORIGIN = 'https://client.thehospitalitycompany.co.uk';
const STAMP = new Date('2026-09-25T09:15:30.123Z');

const gala = (over: Partial<PortalEvent> = {}): PortalEvent => ({
  id: EVENT_ID,
  title: 'Gala Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventDate: '2026-09-19',
  poNumber: '4471-A',
  onsiteContact: 'Marco Vitale · Banqueting manager',
  startsAt: '2026-09-19T06:00:00Z', // 07:00 BST
  endsAt: '2026-09-19T22:30:00Z', // 23:30 BST
  status: 'upcoming',
  ...over,
});

const build = (event: PortalEvent) =>
  buildIcs(event, { lineupUrl: lineupUrlFor(ORIGIN, event.id), stampedAt: STAMP });

/** RFC 5545 §3.1 unfolding: a CRLF followed by one space disappears. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and every kind of line break', () => {
    expect(escapeText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(escapeText('one\ntwo\r\nthree\rfour')).toBe('one\\ntwo\\nthree\\nfour');
  });

  it('escapes the backslash first, so an added escape is not doubled', () => {
    expect(escapeText('\\;')).toBe('\\\\\\;');
    expect(escapeText('C:\\new')).toBe('C:\\\\new');
  });

  it('leaves colons and other text alone', () => {
    expect(escapeText('Line-up: https://x.test/a?b=1')).toBe('Line-up: https://x.test/a?b=1');
  });
});

describe('foldLine', () => {
  const octets = (s: string) => new TextEncoder().encode(s).length;

  it('leaves a line of 75 octets or fewer whole', () => {
    const line = 'X'.repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it('folds longer lines at 75 octets, continuations led by one space', () => {
    const line = `DESCRIPTION:${'a'.repeat(200)}`;
    const folded = foldLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    for (const p of physical) expect(octets(p)).toBeLessThanOrEqual(75);
    expect(physical[0]).toHaveLength(75);
    for (const p of physical.slice(1)) expect(p.startsWith(' ')).toBe(true);
    expect(unfold(folded)).toBe(line);
  });

  it('counts octets, not characters, and never splits a multi-byte character', () => {
    // é is 2 octets, 🍽 is 4: 50 of each is 300 octets in 100 characters.
    const line = `SUMMARY:${'é🍽'.repeat(50)}`;
    const folded = foldLine(line);
    const physical = folded.split('\r\n');
    for (const p of physical) {
      expect(octets(p)).toBeLessThanOrEqual(75);
      // A lone surrogate would mean a character was cut in half.
      expect(p).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
      );
    }
    expect(unfold(folded)).toBe(line);
  });
});

describe('icsUtc', () => {
  it('writes the instant in UTC with a Z and no milliseconds', () => {
    expect(icsUtc('2026-09-19T06:00:00Z')).toBe('20260919T060000Z');
    expect(icsUtc(STAMP)).toBe('20260925T091530Z');
  });

  it('converts an offset timestamp to UTC, across BST and GMT', () => {
    expect(icsUtc('2026-09-19T07:00:00+01:00')).toBe('20260919T060000Z'); // BST
    expect(icsUtc('2026-11-19T07:00:00+00:00')).toBe('20261119T070000Z'); // GMT
    expect(icsUtc('2026-09-19T23:30:00+04:00')).toBe('20260919T193000Z');
  });

  it('refuses a value that is not a date', () => {
    expect(() => icsUtc('not a date')).toThrow(RangeError);
  });
});

describe('buildIcs', () => {
  it('writes a complete VCALENDAR with CRLF line endings', () => {
    const ics = build(gala());
    expect(ics).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//The Hospitality Company//Client Portal//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${EVENT_ID}@thehospitalitycompany.co.uk`,
        'DTSTAMP:20260925T091530Z',
        'DTSTART:20260919T060000Z',
        'DTEND:20260919T223000Z',
        'SUMMARY:Gala Dinner',
        'LOCATION:Leonardo Royal Hotel\\, 10 Godliman St\\, EC4V 5AJ',
        // 75 octets, then the fold.
        'DESCRIPTION:PO number: 4471-A\\nLine-up: https://client.thehospitalitycompan',
        ` y.co.uk/client/events/${EVENT_ID}`,
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('leaves the PO number out when there is none', () => {
    const ics = unfold(build(gala({ poNumber: null })));
    expect(ics).toContain(
      `DESCRIPTION:Line-up: https://client.thehospitalitycompany.co.uk/client/events/${EVENT_ID}\r\n`,
    );
    expect(ics).not.toContain('PO number');
  });

  it('escapes the title and venue', () => {
    const ics = unfold(
      build(gala({ title: 'Dinner; Awards, Part 2', venueName: 'The \\ Hall', venueAddress: '' })),
    );
    expect(ics).toContain('SUMMARY:Dinner\\; Awards\\, Part 2\r\n');
    expect(ics).toContain('LOCATION:The \\\\ Hall\r\n');
  });

  it('keeps every physical line within 75 octets', () => {
    const ics = build(
      gala({
        title: 'Summer Garden Party & Awards Ceremony — Terrace Bar, Marquee and Rooftop Café',
        venueAddress: 'Unit 4, The Old Brewery Yard, 12 Long Winding Street, London SE1 9ZZ',
      }),
    );
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('carries no worker name, no contact and no money, whatever the page holds', () => {
    // The page's event object also carries the on-site contact; the file
    // reads only the fields it names.
    const ics = unfold(build(gala()));
    expect(ics).not.toContain('Marco');
    expect(ics).not.toMatch(/£|rate|charge|pay|margin/i);
    const props = ics
      .split('\r\n')
      .filter(Boolean)
      .map((l) => l.slice(0, l.indexOf(':')));
    expect(props).toEqual([
      'BEGIN',
      'VERSION',
      'PRODID',
      'CALSCALE',
      'METHOD',
      'BEGIN',
      'UID',
      'DTSTAMP',
      'DTSTART',
      'DTEND',
      'SUMMARY',
      'LOCATION',
      'DESCRIPTION',
      'END',
      'END',
    ]);
  });
});

describe('icsFileName and lineupUrlFor', () => {
  it('is "{title}.ics", with characters no file system takes replaced', () => {
    expect(icsFileName('Gala Dinner')).toBe('Gala Dinner.ics');
    expect(icsFileName('Gala / After-party: "VIP"')).toBe('Gala - After-party- -VIP-.ics');
    expect(icsFileName('  ')).toBe('event.ics');
  });

  it("builds the event page's URL on the portal's origin", () => {
    expect(lineupUrlFor(`${ORIGIN}/`, EVENT_ID)).toBe(`${ORIGIN}/client/events/${EVENT_ID}`);
  });
});
