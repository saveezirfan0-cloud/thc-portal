import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ScheduledWindow } from '../components/ScheduledWindow';

/**
 * §1.8: a scheduled time is UK first, with a "your time" line only when the
 * reader's zone differs. Lifted from apps/office, where three copies of it
 * had grown, so the client and staff apps can share the one.
 *
 * The zone is passed in here; in the product it is the browser's, read once
 * mounted, which is why the server render is always the UK-only form.
 */
const STARTS = '2026-09-26T16:00:00Z'; // 17:00 BST
const ENDS = '2026-09-26T22:30:00Z'; // 23:30 BST

describe('ScheduledWindow (§1.8)', () => {
  it('is a plain UK clock for a reader in the UK', () => {
    const markup = renderToStaticMarkup(
      <ScheduledWindow startsAt={STARTS} endsAt={ENDS} zone="Europe/London" />,
    );
    expect(markup).toBe('<span>17:00 – 23:30</span>');
  });

  it('labels the UK line and adds "your time" for a reader elsewhere', () => {
    const markup = renderToStaticMarkup(
      <ScheduledWindow startsAt={STARTS} endsAt={ENDS} zone="Europe/Berlin" />,
    );
    expect(markup).toBe(
      '<span>17:00 – 23:30 UK time<span class="sub">18:00 – 00:30 your time</span></span>',
    );
  });

  it('is UK-only on the server, where the zone is unknown', () => {
    // No zone: the hook's first value is Europe/London, and effects do not
    // run under renderToStaticMarkup — exactly the SSR paint.
    const markup = renderToStaticMarkup(<ScheduledWindow startsAt={STARTS} endsAt={ENDS} />);
    expect(markup).not.toContain('your time');
  });

  it('takes the column’s own conventions: separator, suffix, second-line class', () => {
    const dense = renderToStaticMarkup(
      <ScheduledWindow startsAt={STARTS} endsAt={ENDS} separator="–" zone="Europe/London" />,
    );
    expect(dense).toBe('<span>17:00–23:30</span>');

    const board = renderToStaticMarkup(
      <ScheduledWindow
        startsAt={STARTS}
        endsAt={ENDS}
        suffix="UK time · 6.5h"
        suffixWhen="always"
        className="win mono"
        lineClass="l2"
        zone="Europe/London"
      />,
    );
    expect(board).toBe('<span class="win mono">17:00 – 23:30 UK time · 6.5h</span>');

    const headed = renderToStaticMarkup(
      <ScheduledWindow startsAt={STARTS} endsAt={ENDS} suffix="" zone="Europe/Berlin" />,
    );
    expect(headed).toBe(
      '<span>17:00 – 23:30<span class="sub">18:00 – 00:30 your time</span></span>',
    );
  });

  it('matches its snapshot in both forms', () => {
    expect(
      renderToStaticMarkup(
        <div>
          <ScheduledWindow startsAt={STARTS} endsAt={ENDS} zone="Europe/London" />
          <ScheduledWindow startsAt={STARTS} endsAt={ENDS} zone="America/New_York" />
          <ScheduledWindow
            startsAt={new Date(STARTS)}
            endsAt={new Date(ENDS)}
            suffix="(UK)"
            className="mono"
            zone="Asia/Kolkata"
          />
        </div>,
      ),
    ).toMatchSnapshot();
  });
});
