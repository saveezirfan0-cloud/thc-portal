import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * /events re-reads its period on a visibility-aware interval
 * (`useVisibleInterval` behind `AutoRefresh`): every 60 s while the tab is
 * shown, at once when it is shown again. It was every 15 s, which re-ran the
 * period's events, sections and fill for each open tab four times a minute
 * (go-live audit 17.10.2026, B2) — the board, /staff and /onboarding were
 * already on 60 s.
 */
const refresh = vi.hoisted(() => ({ everyMs: [] as (number | undefined)[] }));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../../_components/AutoRefresh', () => ({
  AutoRefresh: ({ everyMs }: { everyMs?: number }) => {
    refresh.everyMs.push(everyMs);
    return null;
  },
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('../data', () => ({
  loadClientNames: async () => ({ clients: [] }),
  loadEventsInRange: async () => ({ events: [], problem: null }),
  loadShiftRecords: async () => null,
}));
vi.mock('../_lib/saved-views-actions', () => ({
  listMySavedViews: async () => ({ ok: true, views: [] }),
}));
vi.mock('../_lib/SavedViewsBar', () => ({ SavedViewsBar: () => null }));
vi.mock('../_components/EventToolbar', () => ({
  EventToolbar: () => null,
  hrefFor: () => '/events',
}));
vi.mock('../../_lib/timeFormat', () => ({ currentTimeFormat: async () => '24h' }));

const { default: Page } = await import('../page');

describe('/events refresh', () => {
  it('re-reads every 60 s, not every 15 s', async () => {
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ view: 'list' }) }));
    expect(refresh.everyMs).toEqual([60_000]);
  });
});
