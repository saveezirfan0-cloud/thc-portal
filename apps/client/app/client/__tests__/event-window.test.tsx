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
    const markup = renderToStaticMarkup(
      <EventWindow startsAt={STARTS} endsAt={ENDS} zone="Europe/Berlin" className="win" />,
    );
    expect(markup).toBe(
      '<span class="win">07:00 – 23:30 UK time<span class="sub">08:00 – 00:30 your time</span></span>',
    );
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
