import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Outside Next there is no server; the action is not under test.
vi.mock('../actions', () => ({ setLineupEmails: vi.fn() }));

const { LineupEmails } = await import('../LineupEmails');

/** ADR-0135 §3: the client card's two line-up email switches. */
describe('Line-up emails on the client card (ADR-0135 §3)', () => {
  it('is two switches for an office role that may write', () => {
    const html = renderToStaticMarkup(
      <LineupEmails clientId="c1" confirmed changed={false} canWrite />,
    );
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).toContain('Line-up fully confirmed — On');
    expect(html).toContain('Line-up changed after the Allocation Timesheet was sent — Off');
    expect(html).toContain('never 23:00–07:00 UK');
  });

  it('is text, not a control, for a viewer (ADR-0060)', () => {
    const html = renderToStaticMarkup(
      <LineupEmails clientId="c1" confirmed changed canWrite={false} />,
    );
    expect(html).not.toContain('role="switch"');
    expect(html).toContain('Line-up fully confirmed — On');
  });
});
