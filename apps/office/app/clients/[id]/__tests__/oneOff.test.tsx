import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Outside Next there is no server; the action is not under test.
vi.mock('../actions', () => ({ setClientOneOff: vi.fn() }));

const { OneOffClient } = await import('../OneOffClient');

/** ADR-0186: the client card's One-off client switch. */
describe('One-off client on the client card (ADR-0186)', () => {
  it('is a switch for an office role that may write', () => {
    const markup = renderToStaticMarkup(<OneOffClient clientId="c1" on canWrite />);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('left out of the lists workers are qualified from');
  });

  it('says a client that is off is a regular client', () => {
    const markup = renderToStaticMarkup(<OneOffClient clientId="c1" on={false} canWrite />);
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('Off — a regular client');
  });

  it('is text, not a control, for a viewer (ADR-0060)', () => {
    const markup = renderToStaticMarkup(<OneOffClient clientId="c1" on canWrite={false} />);
    expect(markup).not.toContain('role="switch"');
    expect(markup).toContain('On — not expected to order again');
  });
});
