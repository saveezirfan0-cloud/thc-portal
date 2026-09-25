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
const { ChromeProvider } = await import('../ChromeContext');

const shell = (chrome: { complianceCount: number; user: { name: string; role?: string } | null }) =>
  renderToStaticMarkup(
    <ChromeProvider value={chrome}>
      <OfficeShell activeHref="/events" title="Scheduling">
        <span />
      </OfficeShell>
    </ChromeProvider>,
  );

/**
 * §4.1: "A counter in the menu — so the manager can see the queue is not
 * empty." Every `wireframes/backoffice/*.html` carries
 * `Compliance <span class="count">7</span>`, on every screen, not only on
 * /compliance — so it is the chrome's, fed by the root layout, and this
 * renders the shell on another screen to prove no page has to pass it.
 */
describe('the Compliance counter in the menu (§4.1)', () => {
  it('shows the Needs-review queue size on the Compliance item, danger-coloured', () => {
    const markup = shell({ complianceCount: 7, user: null });
    expect(markup).toMatch(
      /href="\/compliance"[^>]*>(?:(?!<\/a>).)*Compliance<\/span><span class="count alert">7<\/span><\/a>/,
    );
  });

  it('shows nothing at zero: the badge says the queue is NOT empty', () => {
    const markup = shell({ complianceCount: 0, user: null });
    expect(markup).not.toContain('class="count');
  });

  it('badges no other item', () => {
    const markup = shell({ complianceCount: 3, user: null });
    expect(markup.match(/class="count/g)).toHaveLength(1);
  });

  it('renders without a provider, as the unit tests of screens do', () => {
    const markup = renderToStaticMarkup(
      <OfficeShell activeHref="/events" title="Scheduling">
        <span />
      </OfficeShell>,
    );
    expect(markup).toContain('>Compliance<');
    expect(markup).not.toContain('class="count');
  });
});

/** The sidebar foot: `dashboard.html` line 38, "Gisela M. · Admin". */
describe('the sidebar foot', () => {
  it('names the signed-in operator from the layout read when no screen passes one', () => {
    const markup = shell({ complianceCount: 0, user: { name: 'Gisela M.', role: 'Admin' } });
    expect(markup).toContain('Gisela M.');
    expect(markup).toContain('>Admin<');
    expect(markup).toContain('title="Gisela M."');
  });

  it('lets a screen that passes `user` win', () => {
    const markup = renderToStaticMarkup(
      <ChromeProvider value={{ complianceCount: 0, user: { name: 'Gisela M.', role: 'Admin' } }}>
        <OfficeShell activeHref="/events" title="Scheduling" user={{ name: 'Operations' }}>
          <span />
        </OfficeShell>
      </ChromeProvider>,
    );
    expect(markup).toContain('Operations');
    expect(markup).not.toContain('Gisela M.');
  });

  it('keeps the sign-out button when there is no operator to show', () => {
    const markup = shell({ complianceCount: 0, user: null });
    expect(markup).toContain('Sign out');
  });
});

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
