import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * §9.1: the dashboard's "view radar →" and "Full report →" are links in
 * `wireframes/backoffice/dashboard.html`. They were plain text while
 * /compliance and /reports were unbuilt; both routes exist now (audit 24.09 §4).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({
    actions,
    children,
  }: {
    actions?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));
vi.mock('../_components/ViewerZone', () => ({ ViewerZone: () => null }));
vi.mock('../_components/UpcomingTable', () => ({ UpcomingTable: () => null }));
vi.mock('../data', () => ({
  loadDashboard: async () => ({ kpis: null, finance: null, upcoming: [], problem: null }),
}));

const { default: Page } = await import('../page');

describe('dashboard links (§9.1)', () => {
  it('links the compliance tile to the Radar tab and the finance panel to Reports', async () => {
    const html = renderToStaticMarkup(await Page());
    expect(html).toMatch(/<a href="\/compliance\?tab=radar"[^>]*>view radar →<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/reports"[^>]*>Full report →<\/a>/);
  });
});
