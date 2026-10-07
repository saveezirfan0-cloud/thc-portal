import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../_components/EventFilters', () => ({ EventFilters: () => null }));

const { EventToolbar } = await import('../_components/EventToolbar');

const base = { date: '2026-10-07', q: '', clientId: '', status: '' };

function grain(view: 'list' | 'month' | 'week' | 'day') {
  const html = renderToStaticMarkup(<EventToolbar query={{ ...base, view }} clients={[]} />);
  const group = /<div class="seg sm"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? '';
  return [...group.matchAll(/<a ([^>]*)>(\w+)<\/a>/g)].map((m) => ({
    label: m[2],
    on: /class="on"/.test(m[1]!),
    href: /href="([^"]+)"/.exec(m[1]!)?.[1]?.replaceAll('&amp;', '&'),
  }));
}

describe('EventToolbar — Month / Week / Day (ADR-0100)', () => {
  it('offers Day from List, none selected, opening the day being read', () => {
    const links = grain('list');
    expect(links.map((l) => l.label)).toEqual(['Month', 'Week', 'Day']);
    expect(links.some((l) => l.on)).toBe(false);
    const day = new URLSearchParams(links[2]!.href!.split('?')[1]);
    expect(day.get('view')).toBe('day');
    expect(day.get('date')).toBe('2026-10-07');
  });

  it('highlights the current grain inside the calendar', () => {
    expect(grain('day').find((l) => l.on)?.label).toBe('Day');
    expect(grain('week').find((l) => l.on)?.label).toBe('Week');
  });
});
