import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Outside Next there is no server; the action is not under test.
vi.mock('../actions', () => ({ setExcludeFromInvoicing: vi.fn() }));

const { ExcludeFromInvoicing } = await import('../ExcludeFromInvoicing');

/** ADR-0203: the client card's invoicing exclusion switch. */
describe('Left out of invoicing on the client card (ADR-0203)', () => {
  it('is a switch for an office role that may write', () => {
    const markup = renderToStaticMarkup(<ExcludeFromInvoicing clientId="c1" excluded canWrite />);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('invoiced outside the platform');
  });

  it('says the client is invoiced from the platform when off', () => {
    const markup = renderToStaticMarkup(
      <ExcludeFromInvoicing clientId="c1" excluded={false} canWrite />,
    );
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('Included — its events are invoiced from the platform');
  });

  it('is text, not a control, for a viewer (ADR-0060)', () => {
    const markup = renderToStaticMarkup(
      <ExcludeFromInvoicing clientId="c1" excluded canWrite={false} />,
    );
    expect(markup).not.toContain('role="switch"');
    expect(markup).toContain('Left out');
  });
});
