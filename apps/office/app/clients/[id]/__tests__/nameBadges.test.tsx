import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Outside Next there is no server; the action is not under test.
vi.mock('../actions', () => ({ setNameBadges: vi.fn() }));

const { NameBadges } = await import('../NameBadges');

/** ADR-0081: the client card's Name badges switch. */
describe('Name badges on the client card (ADR-0081)', () => {
  it('is a switch for an office role that may write', () => {
    const markup = renderToStaticMarkup(<NameBadges clientId="c1" on canWrite />);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('the Allocation Timesheet email carries a THC name badge');
  });

  it('says it is off, and that the sheet goes on its own', () => {
    const markup = renderToStaticMarkup(<NameBadges clientId="c1" on={false} canWrite />);
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('Off — the Allocation Timesheet goes on its own');
  });

  it('is text, not a control, for a viewer (ADR-0060)', () => {
    const markup = renderToStaticMarkup(<NameBadges clientId="c1" on canWrite={false} />);
    expect(markup).not.toContain('role="switch"');
    expect(markup).toContain('On — the Allocation Timesheet email carries a THC name badge');
  });
});
