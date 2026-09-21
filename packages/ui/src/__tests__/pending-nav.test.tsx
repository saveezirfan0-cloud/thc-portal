import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Sidebar } from '../components/Shell';
import { BottomNav } from '../components/Mobile';

/**
 * Phase 0 ships a full sidebar for a product whose routes mostly do not
 * exist yet. Linking to them hands the visitor a 404 from the app's own
 * navigation, which reads as broken rather than unfinished.
 */
describe('a route that has not been built yet', () => {
  const html = (n: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(n);

  it('is not a link in the sidebar', () => {
    const markup = html(
      <Sidebar
        items={[
          { href: '/', label: 'Dashboard' },
          { href: '/reports', label: 'Reports', pending: true },
        ]}
      />,
    );
    expect(markup).toContain('href="/"');
    expect(markup).not.toContain('href="/reports"');
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('soon');
  });

  it('is not a link in the bottom nav either', () => {
    const markup = html(
      <BottomNav
        items={[
          { href: '/', label: 'Shifts' },
          { href: '/radar', label: 'Radar', pending: true },
        ]}
      />,
    );
    expect(markup).toContain('href="/"');
    expect(markup).not.toContain('href="/radar"');
    expect(markup).toContain('aria-disabled="true"');
  });

  it('still links everything that does exist', () => {
    const markup = html(
      <Sidebar items={[{ href: '/venues', label: 'Venues' }]} activeHref="/venues" />,
    );
    expect(markup).toContain('href="/venues"');
    expect(markup).not.toContain('aria-disabled');
  });
});
