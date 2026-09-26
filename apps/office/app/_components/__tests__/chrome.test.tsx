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

const { NavCountsProvider, withCounts } = await import('../OfficeSidebar');

/**
 * §4.1: "A counter in the menu — so the manager can see the queue is not
 * empty." The root layout provides the number; every screen's shell shows it
 * on Compliance, coral as the wireframe draws it.
 */
describe('the Back Office menu counters', () => {
  it('shows the Needs-review count on Compliance', () => {
    const markup = renderToStaticMarkup(
      <NavCountsProvider counts={{ '/compliance': 7 }}>
        <OfficeShell activeHref="/staff" title="Staff">
          <span />
        </OfficeShell>
      </NavCountsProvider>,
    );
    const compliance = markup.slice(markup.indexOf('href="/compliance"'));
    const link = compliance.slice(0, compliance.indexOf('</a>'));
    expect(link).toContain('Compliance');
    expect(link).toContain('<span class="count alert">7</span>');
    // Once in the sidebar and once on the phone tab bar's Compliance tab —
    // CSS shows one or the other, never both.
    expect(markup.match(/class="count/g)).toHaveLength(2);
    const tab = markup.slice(markup.indexOf('class="pnav-bar"'));
    expect(tab.slice(tab.indexOf('href="/compliance"'))).toContain(
      '<span class="count alert">7</span>',
    );
  });

  it('paints the number the layout counted, whatever it is', () => {
    // §4.1's "the menu counter is this number": three rows in
    // compliance_review_queue_v are a 3, drawn the way the wireframe draws
    // its 7 — one badge, on Compliance only, coral.
    const markup = renderToStaticMarkup(
      <NavCountsProvider counts={{ '/compliance': 3 }}>
        <OfficeShell activeHref="/compliance" title="Compliance">
          <span />
        </OfficeShell>
      </NavCountsProvider>,
    );
    expect(markup).toContain('<span class="count alert">3</span>');
    // Once in the sidebar and once on the phone tab bar (ADR-0030).
    expect(markup.match(/class="count/g)).toHaveLength(2);
  });

  it('hides the badge at zero — an empty queue draws no counter', () => {
    const markup = renderToStaticMarkup(
      <NavCountsProvider counts={{ '/compliance': 0 }}>
        <OfficeShell activeHref="/compliance" title="Compliance">
          <span />
        </OfficeShell>
      </NavCountsProvider>,
    );
    expect(markup).toContain('href="/compliance"');
    expect(markup).not.toContain('class="count');
  });

  it('shows nothing when the queue is empty or the count is unknown', () => {
    const markup = renderToStaticMarkup(
      <OfficeShell activeHref="/staff" title="Staff">
        <span />
      </OfficeShell>,
    );
    expect(markup).not.toContain('class="count');
    const items = [{ href: '/compliance', label: 'Compliance' }];
    expect(withCounts(items, { '/compliance': 0 })).toEqual(items);
  });
});

/**
 * §1.2: the Back Office works on a phone. Below 760px the sidebar gives way
 * to a tab bar — Dashboard, Scheduling, Compliance, Check-in and More —
 * and the rest of the menu, sign-out and the appearance switch live in the
 * More sheet. The switch stays in the top-bar markup (hidden on a phone by
 * `.hide-phone`), so the assertions above still hold at every width.
 */
describe('the Back Office phone menu', () => {
  it('gives the four day-of-operations screens a tab and hides the rest behind More', () => {
    const markup = renderToStaticMarkup(
      <OfficeShell activeHref="/events" title="Scheduling">
        <span />
      </OfficeShell>,
    );
    const bar = markup.slice(markup.indexOf('class="pnav-bar"'));
    const tabs = [...bar.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(['/dashboard', '/events', '/compliance', '/checkin']);
    expect(bar).toContain('>Check-in<');
    expect(bar).toContain('aria-expanded="false"');
    expect(bar).toContain('>More<');
    expect(bar).toMatch(
      /class="pnav-tab active"[^>]*href="\/events"|href="\/events"[^>]*class="pnav-tab active"/,
    );
  });

  it('carries a hidden counter on More, so a queue is never out of sight', () => {
    const markup = renderToStaticMarkup(
      <NavCountsProvider counts={{ '/onboarding': 4 }}>
        <OfficeShell activeHref="/staff" title="Staff">
          <span />
        </OfficeShell>
      </NavCountsProvider>,
    );
    const bar = markup.slice(markup.indexOf('class="pnav-bar"'));
    const more = bar.slice(bar.indexOf('>More<'));
    expect(more).toContain('<span class="count alert">4</span>');
  });
});

const { SignedInAsProvider } = await import('../SignedInAs');

/**
 * ADR-0050: the menu leaves out what the signed-in office role cannot use.
 * Presentation only — the pages say "Not available for your role" and the
 * database refuses regardless — but a menu item that always errors reads
 * as a broken product.
 */
describe('the Back Office menu per office role', () => {
  const render = (officeRole?: 'owner' | 'manager' | 'scheduler') =>
    renderToStaticMarkup(
      <SignedInAsProvider user={{ name: 'Test User', ...(officeRole ? { officeRole } : {}) }}>
        <OfficeShell activeHref="/dashboard" title="Dashboard">
          <span />
        </OfficeShell>
      </SignedInAsProvider>,
    );

  it('shows an owner every section', () => {
    const markup = render('owner');
    for (const href of ['/reports', '/roles', '/settings', '/users']) {
      expect(markup).toContain(`href="${href}"`);
    }
  });

  it('drops Settings and Users & access for a manager', () => {
    const markup = render('manager');
    expect(markup).not.toContain('href="/settings"');
    expect(markup).not.toContain('href="/users"');
    expect(markup).toContain('href="/reports"');
    expect(markup).toContain('href="/roles"');
  });

  it('also drops Reports and Roles & rates for a scheduler', () => {
    const markup = render('scheduler');
    for (const href of ['/reports', '/roles', '/settings', '/users']) {
      expect(markup).not.toContain(`href="${href}"`);
    }
    for (const href of ['/events', '/staff', '/clients', '/venues', '/activity', '/account']) {
      expect(markup).toContain(`href="${href}"`);
    }
  });

  it('hides nothing when the role is unknown', () => {
    expect(render()).toContain('href="/users"');
  });
});
