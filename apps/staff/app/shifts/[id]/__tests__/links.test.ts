import { describe, expect, it } from 'vitest';
import { checkInCountdown, directionsUrl, formatCountdown, phoneFromContact } from '../links';

describe('directionsUrl', () => {
  const venue = {
    venueName: 'Mandarin Oriental',
    venueAddress: '66 Knightsbridge, London SW1X 7LA',
  };

  it('uses the pin where there is one — the geofence centre', () => {
    expect(directionsUrl({ ...venue, venueLat: 51.5022, venueLng: -0.1598 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=51.5022%2C-0.1598',
    );
  });

  it('falls back to the name and address for a venue with no pin (0, 0 or absent)', () => {
    const expected =
      'https://www.google.com/maps/dir/?api=1&destination=' +
      encodeURIComponent('Mandarin Oriental, 66 Knightsbridge, London SW1X 7LA');
    expect(directionsUrl({ ...venue, venueLat: 0, venueLng: 0 })).toBe(expected);
    expect(directionsUrl(venue)).toBe(expected);
  });

  it('is null with nothing to go on', () => {
    expect(directionsUrl({ venueName: '', venueAddress: ' ' })).toBeNull();
  });
});

describe('phoneFromContact — tap-to-call', () => {
  it('finds a UK mobile and links it as tel:', () => {
    expect(phoneFromContact('Sam Patel — 07700 900123')).toEqual({
      before: 'Sam Patel — ',
      display: '07700 900123',
      href: 'tel:07700900123',
      after: '',
    });
  });

  it('keeps the + and drops the "(0)" trunk digit of an international number', () => {
    const phone = phoneFromContact('Front desk +44 (0)20 7946 0000 (ask for Jo)');
    expect(phone?.href).toBe('tel:+442079460000');
    expect(phone?.display).toBe('+44 (0)20 7946 0000');
    expect(phone?.after).toBe(' (ask for Jo)');
  });

  it('skips a date to reach the number', () => {
    expect(phoneFromContact('From 12.09.2026: Jo on 020-7946-0001')?.href).toBe('tel:02079460001');
  });

  it('is null where there is no number', () => {
    expect(phoneFromContact('Ask at reception for Sam')).toBeNull();
    expect(phoneFromContact('Gate 12, bay 3')).toBeNull();
    expect(phoneFromContact(null)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('rounds minutes up, so it never says 0 while the window is shut', () => {
    expect(formatCountdown(30_000)).toBe('less than a minute');
    expect(formatCountdown(61_000)).toBe('2 min');
    expect(formatCountdown(45 * 60_000)).toBe('45 min');
    expect(formatCountdown(2 * 3_600_000 + 15 * 60_000)).toBe('2 h 15 min');
    expect(formatCountdown(3 * 3_600_000)).toBe('3 h');
    expect(formatCountdown(3 * 86_400_000 + 4 * 3_600_000)).toBe('3 d 4 h');
    expect(formatCountdown(86_400_000)).toBe('1 d');
  });
});

describe('checkInCountdown — the window from checkInWindow() (start − 30 min)', () => {
  const start = '2026-09-26T17:00:00Z'; // opens 16:30Z

  it('counts down to the opening, not the start', () => {
    expect(checkInCountdown(start, new Date('2026-09-26T14:15:00Z'))).toBe(
      'Check-in opens in 2 h 15 min',
    );
  });

  it('is null once the window has opened', () => {
    expect(checkInCountdown(start, new Date('2026-09-26T16:30:00Z'))).toBeNull();
  });
});
