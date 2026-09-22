import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The shell renders next/link for every nav item. Outside Next there is no
// router context to give it, and the link is not what is under test.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { OfficeShell } = await import('../OfficeShell');

/**
 * ADR-0007's appearance switch belongs to the chrome, not to a screen. It
 * spent its first life as a page-local component on `/design-system`, which
 * is exactly how a control disappears from a product without anyone
 * noticing, so the Back Office top bar asserts it is there.
 */
describe('the Back Office top bar', () => {
  it('carries the appearance switch', () => {
    const markup = renderToStaticMarkup(
      <OfficeShell activeHref="/events" title="Scheduling">
        <span />
      </OfficeShell>,
    );
    expect(markup).toContain('aria-label="Appearance"');
    expect(markup).toContain('>Light<');
    expect(markup).toContain('>Dark<');
  });

  it('keeps whatever actions the screen passed as well', () => {
    const markup = renderToStaticMarkup(
      <OfficeShell activeHref="/events" title="Scheduling" actions={<button>New event</button>}>
        <span />
      </OfficeShell>,
    );
    expect(markup).toContain('New event');
    expect(markup).toContain('aria-label="Appearance"');
  });
});
