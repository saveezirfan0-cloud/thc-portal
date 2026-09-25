import { describe, expect, it } from 'vitest';
import { buildShiftIcs, foldLine, icsDateTime, icsFilename, icsText } from '../ics';

/**
 * "Add to calendar" (§10.4) — RFC 5545 as the phone's calendar reads it.
 */
const shift = {
  bookingId: '6f1c0f7e-1111-4222-8333-944455556666',
  eventTitle: 'Product Launch — Bar',
  roleName: 'Bar Staff',
  // 18:00–01:00 BST on Sat 26 Sep 2026: the role window, past midnight.
  startsAt: new Date('2026-09-26T17:00:00Z'),
  endsAt: new Date('2026-09-27T00:00:00Z'),
  venueName: 'Mandarin Oriental',
  venueAddress: '66 Knightsbridge, London SW1X 7LA',
  venueLat: 51.5022,
  venueLng: -0.1598,
  dressCode: 'Black tie; polished shoes',
  onsiteContact: 'Sam Patel, 07700 900123',
  url: 'https://staff.example/shifts/6f1c0f7e-1111-4222-8333-944455556666',
};
const STAMP = new Date('2026-09-25T13:00:00.123Z');

/** Unfold (RFC 5545 §3.1) and split into content lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');

describe('icsDateTime', () => {
  it('writes UTC in the basic "Z" form, no separators, no milliseconds', () => {
    expect(icsDateTime(STAMP)).toBe('20260925T130000Z');
  });
});

describe('icsText — §3.3.11 escaping', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(icsText('a\\b; c, d\ne\r\nf')).toBe('a\\\\b\\; c\\, d\\ne\\nf');
  });
});

describe('foldLine — §3.1, 75 octets', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Gala')).toBe('SUMMARY:Gala');
  });

  it('folds by UTF-8 octets with CRLF + space, never splitting a character', () => {
    const line = `SUMMARY:${'—'.repeat(40)}`; // 8 + 120 octets
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p, i) => {
      expect(bytes(p)).toBeLessThanOrEqual(75);
      if (i > 0) expect(p.startsWith(' ')).toBe(true);
    });
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });
});

describe('buildShiftIcs', () => {
  const ics = buildShiftIcs(shift, STAMP);
  const lines = unfold(ics);

  it('is a VCALENDAR with one VEVENT, CRLF throughout and a final CRLF', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines.some((l) => l.startsWith('PRODID:'))).toBe(true);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('carries the ROLE window in UTC "Z" form (RULE-18)', () => {
    expect(lines).toContain('DTSTART:20260926T170000Z');
    expect(lines).toContain('DTEND:20260927T000000Z');
    expect(lines).toContain('DTSTAMP:20260925T130000Z');
  });

  it('has a UID stable per booking, whatever the times or the stamp', () => {
    const moved = unfold(
      buildShiftIcs(
        { ...shift, startsAt: new Date('2026-09-26T16:00:00Z') },
        new Date('2026-09-26T08:00:00Z'),
      ),
    );
    const uid = (ls: string[]) => ls.find((l) => l.startsWith('UID:'));
    expect(uid(lines)).toBe(`UID:booking-${shift.bookingId}@thehospitalitycompany.co.uk`);
    expect(uid(moved)).toBe(uid(lines));
  });

  it('SUMMARY is event · role; LOCATION the venue and its address, escaped', () => {
    expect(lines).toContain('SUMMARY:Product Launch — Bar · Bar Staff');
    expect(lines).toContain('LOCATION:Mandarin Oriental\\, 66 Knightsbridge\\, London SW1X 7LA');
    expect(lines).toContain('GEO:51.5022;-0.1598');
  });

  it('puts the dress code and contact in the description, and no money anywhere', () => {
    const description = lines.find((l) => l.startsWith('DESCRIPTION:'));
    expect(description).toContain('Dress code: Black tie\\; polished shoes');
    expect(description).toContain('On-site contact: Sam Patel\\, 07700 900123');
    expect(ics).not.toContain('£');
  });

  it('omits GEO for a venue with no pin (0, 0)', () => {
    const noPin = unfold(buildShiftIcs({ ...shift, venueLat: 0, venueLng: 0 }, STAMP));
    expect(noPin.some((l) => l.startsWith('GEO:'))).toBe(false);
  });
});

describe('icsFilename', () => {
  it('names the UK day the section starts on', () => {
    // 00:30 BST on the 27th is still the 26th in UTC.
    expect(icsFilename(new Date('2026-09-26T23:30:00Z'))).toBe('thc-shift-2026-09-27.ics');
  });
});
