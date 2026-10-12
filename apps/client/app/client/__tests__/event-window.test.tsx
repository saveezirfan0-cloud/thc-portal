import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventWindow, yourTimeLine } from '../EventWindow';

/**
 * §1.8 on the portal's two screens: a scheduled window is "UK time" for
 * every reader — the label is written even in London, as the wireframes
 * draw it ("11:00 – 16:00 UK time") — with a "your time" second line only
 * for a reader elsewhere. Never a bare clock.
 */
const STARTS = '2026-09-19T06:00:00Z'; // 07:00 BST
const ENDS = '2026-09-19T22:30:00Z'; // 23:30 BST

describe('EventWindow (§1.8)', () => {
  it('labels the UK line for a reader in London and adds no second line', () => {
    const markup = renderToStaticMarkup(
      <EventWindow startsAt={STARTS} endsAt={ENDS} zone="Europe/London" />,
    );
    expect(markup).toBe('<span>07:00 – 23:30 UK time</span>');
  });

  it('adds the "your time" line, as a .sub, for a reader in Berlin', () => {
    // 23:30 in London is 00:30 the next day in Berlin: the Berlin line
    // crosses midnight and says so; the UK line does not (ADR-0050).
    const markup = renderToStaticMarkup(
      <EventWindow startsAt={STARTS} endsAt={ENDS} zone="Europe/Berlin" className="win" />,
    );
    expect(markup).toBe(
      '<span class="win">07:00 – 23:30 UK time<span class="sub">08:00 – 00:30 your time (+1 day)</span></span>',
    );
  });

  it('marks only the line that crosses midnight in its own zone (Dubai)', () => {
    const markup = renderToStaticMarkup(
      <EventWindow startsAt={STARTS} endsAt={ENDS} zone="Asia/Dubai" />,
    );
    expect(markup).toBe(
      '<span>07:00 – 23:30 UK time<span class="sub">10:00 – 02:30 your time (+1 day)</span></span>',
    );
  });

  it('marks the UK line of an overnight role, and not a reader line that stays on one day', () => {
    // 17:00 – 01:30 BST is 12:00 – 20:30 in New York: one side of midnight.
    const markup = renderToStaticMarkup(
      <EventWindow
        startsAt="2026-09-19T16:00:00Z"
        endsAt="2026-09-20T00:30:00Z"
        zone="America/New_York"
      />,
    );
    expect(markup).toBe(
      '<span>17:00 – 01:30 UK time (+1 day)<span class="sub">12:00 – 20:30 your time</span></span>',
    );
  });

  it('as `breakable`, cuts each line into unbreakable pieces with the same words', () => {
    // The list's Date cell on a tablet: a far reader's line may wrap, but
    // only between "Fri 18 Sep", the window, and "(+1 day)".
    const markup = renderToStaticMarkup(
      <EventWindow
        startsAt="2026-09-19T00:30:00Z"
        endsAt="2026-09-19T04:30:00Z"
        zone="America/New_York"
        breakable
      />,
    );
    expect(markup).toBe(
      '<span><span class="wseg">01:30 – 05:30 UK time</span>' +
        '<span class="sub"><span class="wseg">Fri 18 Sep</span> <span class="wseg">20:30 – 00:30 your time</span> <span class="wseg">(+1 day)</span></span></span>',
    );
    const text = markup.replace(/<[^>]+>/g, '');
    expect(text).toBe(
      '01:30 – 05:30 UK time' +
        yourTimeLine('2026-09-19T00:30:00Z', '2026-09-19T04:30:00Z', 'America/New_York'),
    );
  });

  it('writes "+2 days" for a window over two midnights', () => {
    const markup = renderToStaticMarkup(
      <EventWindow
        startsAt="2026-09-18T16:00:00Z"
        endsAt="2026-09-20T01:00:00Z"
        zone="Europe/London"
      />,
    );
    expect(markup).toBe('<span>17:00 – 02:00 UK time (+2 days)</span>');
  });

  it('keeps the UK marker in the server render, which has no second line', () => {
    // The UK line's marker is computed in Europe/London, so it is the same
    // string on the server and in the browser: no hydration mismatch.
    const markup = renderToStaticMarkup(
      <EventWindow startsAt="2026-09-19T16:00:00Z" endsAt="2026-09-20T00:30:00Z" />,
    );
    expect(markup).toBe('<span>17:00 – 01:30 UK time (+1 day)</span>');
  });

  it("is UK-only on the server, where the reader's zone is unknown", () => {
    // No zone: the hook's first value is Europe/London and effects do not
    // run under renderToStaticMarkup — exactly the first paint, so
    // hydration cannot disagree with it.
    const markup = renderToStaticMarkup(<EventWindow startsAt={STARTS} endsAt={ENDS} />);
    expect(markup).toContain('UK time');
    expect(markup).not.toContain('your time');
  });
});

describe('the "your time" line names its own day when it differs (§1.8)', () => {
  it("prefixes the viewer's date when their start falls on another calendar day", () => {
    // 01:30 – 05:30 BST on Sat 19 Sep is 20:30 – 00:30 on Fri 18 Sep in New York.
    expect(yourTimeLine('2026-09-19T00:30:00Z', '2026-09-19T04:30:00Z', 'America/New_York')).toBe(
      'Fri 18 Sep 20:30 – 00:30 your time (+1 day)',
    );
    // 23:00 – 03:00 BST from Fri 18 Sep is 07:00 – 11:00 on Sat 19 Sep in Tokyo.
    expect(yourTimeLine('2026-09-18T22:00:00Z', '2026-09-19T02:00:00Z', 'Asia/Tokyo')).toBe(
      'Sat 19 Sep 07:00 – 11:00 your time',
    );
  });

  it('leaves the date off when the day is the same as the UK one', () => {
    expect(yourTimeLine(STARTS, ENDS, 'Europe/Berlin')).toBe('08:00 – 00:30 your time (+1 day)');
  });

  it('draws it in the component', () => {
    const markup = renderToStaticMarkup(
      <EventWindow
        startsAt="2026-09-19T00:30:00Z"
        endsAt="2026-09-19T04:30:00Z"
        zone="America/New_York"
      />,
    );
    expect(markup).toBe(
      '<span>01:30 – 05:30 UK time<span class="sub">Fri 18 Sep 20:30 – 00:30 your time (+1 day)</span></span>',
    );
  });

  it('is right across the clock change on 28.03.2027', () => {
    // 00:30 GMT Sun 28 Mar; BST begins at 01:00 UTC. 20:30 Sat 27 Mar in New York (EDT).
    expect(yourTimeLine('2027-03-28T00:30:00Z', '2027-03-28T03:00:00Z', 'America/New_York')).toBe(
      'Sat 27 Mar 20:30 – 23:00 your time',
    );
  });

  it('adds no line at all for a reader in a Crown Dependency', () => {
    const markup = renderToStaticMarkup(
      <EventWindow startsAt={STARTS} endsAt={ENDS} zone="Europe/Guernsey" />,
    );
    expect(markup).toBe('<span>07:00 – 23:30 UK time</span>');
  });
});
