import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * /compliance's topbar names the reader's own zone rather than asserting
 * "Europe/London" for everyone: the stamps below it are UK audit stamps,
 * and a reader abroad is told which zone they are in.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../data', () => ({
  loadCompliance: async () => ({
    queue: [],
    radar: [],
    warnings: [],
    rotaGuardMode: 'block',
    rtwCheckEnabled: false,
    problem: null,
  }),
}));
vi.mock('../ComplianceScreen', () => ({ ComplianceScreen: () => null }));
vi.mock('../../checkin/ViewerZone', () => ({
  ViewerZone: () => <span>viewer-zone</span>,
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ timezone, children }: { timezone: ReactNode; children: ReactNode }) => (
    <div>
      <header>{timezone}</header>
      {children}
    </div>
  ),
}));

const { default: Page } = await import('../page');

describe('/compliance topbar', () => {
  it('shows the viewer’s own zone, not a fixed UK label', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<header><span>viewer-zone</span></header>');
    expect(html).not.toContain('Viewer: Europe/London (UK)');
  });
});
