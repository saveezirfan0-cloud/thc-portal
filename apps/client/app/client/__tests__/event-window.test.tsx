import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventWindow } from '../EventWindow';

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
    // crosses midnight and says so; the UK line does not (ADR-0035).
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
