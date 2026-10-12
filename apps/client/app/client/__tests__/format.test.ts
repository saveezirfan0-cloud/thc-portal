import { describe, expect, it } from 'vitest';
import {
  dayMarker,
  daysBetweenIn,
  daysLaterIn,
  differentDayFromUk,
  ukDayMonth,
  ukStamp,
  utcOffsetLabel,
} from '../format';

/**
 * The overnight marker's date maths (ADR-0050): how many calendar days an
 * end falls after its start, judged on the wall clock of one zone. The
 * clock changes are the cases that matter — Europe/London goes to GMT at
 * 01:00 UTC on 25 Oct 2026 (a 25-hour Sunday) and to BST at 01:00 UTC on
 * 29 Mar 2026 (a 23-hour one), so "elapsed hours ÷ 24" is wrong on both.
 */
const LONDON = 'Europe/London';

describe('daysLaterIn', () => {
  it('is 0 for a same-day window and 1 across midnight, per zone', () => {
    // 07:00 – 23:30 BST: London stays on the 19th; Dubai (UTC+4) runs 10:00 – 02:30.
    expect(daysLaterIn('2026-09-19T06:00:00Z', '2026-09-19T22:30:00Z', LONDON)).toBe(0);
    expect(daysLaterIn('2026-09-19T06:00:00Z', '2026-09-19T22:30:00Z', 'Asia/Dubai')).toBe(1);
  });

  it('judges each zone independently: overnight in London, one day in Los Angeles', () => {
    // 17:00 BST → 01:30 BST; in LA that is 09:00 → 17:30 PDT on the 19th.
    const [s, e] = ['2026-09-19T16:00:00Z', '2026-09-20T00:30:00Z'];
    expect(daysLaterIn(s, e, LONDON)).toBe(1);
    expect(daysLaterIn(s, e, 'America/Los_Angeles')).toBe(0);
  });

  it('counts a morning start in LA that is the previous evening there', () => {
    // 07:00 – 15:00 BST is 23:00 (18th) – 07:00 (19th) PDT.
    expect(daysLaterIn('2026-09-19T06:00:00Z', '2026-09-19T14:00:00Z', 'America/Los_Angeles')).toBe(
      1,
    );
  });

  it('BST → GMT: 25 hours inside one London day is still the same day', () => {
    // 00:30 BST on Sun 25 Oct → 23:30 GMT the same Sunday: 24 h elapsed.
    expect(daysLaterIn('2026-10-24T23:30:00Z', '2026-10-25T23:30:00Z', LONDON)).toBe(0);
  });

  it('BST → GMT: an overnight role across the change is +1', () => {
    // 17:00 BST Sat 24 Oct → 01:30 GMT Sun 25 Oct.
    expect(daysLaterIn('2026-10-24T16:00:00Z', '2026-10-25T01:30:00Z', LONDON)).toBe(1);
  });

  it('GMT → BST: 23 hours can still cross a midnight', () => {
    // 23:30 GMT Sat 28 Mar → 23:30 BST Sun 29 Mar: 23 h elapsed, one day later.
    expect(daysLaterIn('2026-03-28T23:30:00Z', '2026-03-29T22:30:00Z', LONDON)).toBe(1);
    // 00:30 GMT → 23:59 BST on Sun 29 Mar: same day.
    expect(daysLaterIn('2026-03-29T00:30:00Z', '2026-03-29T22:59:00Z', LONDON)).toBe(0);
  });

  it('counts two midnights as 2', () => {
    expect(daysLaterIn('2026-09-18T16:00:00Z', '2026-09-20T01:00:00Z', LONDON)).toBe(2);
  });

  it('takes Date objects as well as ISO strings, and never goes negative', () => {
    expect(
      daysLaterIn(new Date('2026-09-19T16:00:00Z'), new Date('2026-09-20T00:30:00Z'), LONDON),
    ).toBe(1);
    expect(daysLaterIn('2026-09-20T00:30:00Z', '2026-09-19T16:00:00Z', LONDON)).toBe(0);
  });
});

describe('dayMarker', () => {
  it('is empty on the same day and singular/plural after', () => {
    expect(dayMarker(0)).toBe('');
    expect(dayMarker(-1)).toBe('');
    expect(dayMarker(1)).toBe(' (+1 day)');
    expect(dayMarker(2)).toBe(' (+2 days)');
    expect(dayMarker(3)).toBe(' (+3 days)');
  });
});

describe('daysBetweenIn · signed', () => {
  it('is negative for an earlier day and agrees with daysLaterIn otherwise', () => {
    expect(daysBetweenIn('2026-09-20T08:00:00Z', '2026-09-19T22:00:00Z', LONDON)).toBe(-1);
    expect(daysBetweenIn('2026-09-19T08:00:00Z', '2026-09-20T08:00:00Z', LONDON)).toBe(1);
    expect(daysLaterIn('2026-09-20T08:00:00Z', '2026-09-19T22:00:00Z', LONDON)).toBe(0);
  });
});

describe('differentDayFromUk', () => {
  it("is true when the viewer's calendar has turned and London's has not", () => {
    // 23:30 BST Fri 18 Sep is 01:30 Sat in Dubai, 18:30 Fri in New York.
    expect(differentDayFromUk('2026-09-18T22:30:00Z', 'Asia/Dubai')).toBe(true);
    expect(differentDayFromUk('2026-09-18T22:30:00Z', 'America/New_York')).toBe(false);
    expect(differentDayFromUk('2026-09-18T22:30:00Z', LONDON)).toBe(false);
  });
});

describe('UK stamps and days', () => {
  it('writes an audit stamp UK-only and labelled, the day unpadded', () => {
    expect(ukStamp('2026-10-05T09:00:00Z')).toBe('5 Oct, 10:00 UK time');
    // After the change to GMT (25.10.2026) the same UTC hour is an hour earlier.
    expect(ukStamp('2026-10-26T09:00:00Z')).toBe('26 Oct, 09:00 UK time');
  });

  it('writes a day as "16 Sep"', () => {
    expect(ukDayMonth('2026-09-16T10:12:00Z')).toBe('16 Sep');
    // 23:30 UTC on 31 Oct is still 31 Oct in GMT.
    expect(ukDayMonth('2026-10-31T23:30:00Z')).toBe('31 Oct');
  });
});

describe('utcOffsetLabel · "Viewer: Europe/Berlin (UTC+2)"', () => {
  it('names the offset in force, either side of the changes', () => {
    expect(utcOffsetLabel('Europe/Berlin', new Date('2026-09-18T12:00:00Z'))).toBe('UTC+2');
    expect(utcOffsetLabel('Europe/Berlin', new Date('2026-10-26T12:00:00Z'))).toBe('UTC+1');
    expect(utcOffsetLabel('America/New_York', new Date('2027-03-29T12:00:00Z'))).toBe('UTC−4');
    expect(utcOffsetLabel('Asia/Kolkata', new Date('2026-09-18T12:00:00Z'))).toBe('UTC+5:30');
    expect(utcOffsetLabel('Atlantic/Reykjavik', new Date('2026-09-18T12:00:00Z'))).toBe('UTC');
  });
});
