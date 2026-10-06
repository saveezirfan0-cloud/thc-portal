import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { EventFilters } = await import('../_components/EventFilters');
const { EventToolbar, hrefFor } = await import('../_components/EventToolbar');
const { filterSetOf, parseEventQuery, sameFilterSet } = await import('../_lib/filters');

const TODAY = '2026-09-25';
const checkbox = (html: string) => /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? '';

describe('Hide cancelled — Office /events (ADR-0094)', () => {
  it('is unchecked by default', () => {
    const html = renderToStaticMarkup(
      <EventFilters query={parseEventQuery({}, TODAY)} clients={[]} />,
    );
    expect(html).toContain('Hide cancelled');
    expect(checkbox(html)).not.toContain('checked');
    expect(checkbox(html)).not.toContain('disabled');
  });

  it('is checked when hide=cancelled is in the URL', () => {
    const html = renderToStaticMarkup(
      <EventFilters query={parseEventQuery({ hide: 'cancelled' }, TODAY)} clients={[]} />,
    );
    expect(checkbox(html)).toContain('checked');
  });

  it('is unchecked and disabled while the status filter asks for Cancelled', () => {
    const html = renderToStaticMarkup(
      <EventFilters
        query={parseEventQuery({ hide: 'cancelled', status: 'cancelled' }, TODAY)}
        clients={[]}
      />,
    );
    expect(checkbox(html)).not.toContain('checked');
    expect(checkbox(html)).toContain('disabled');
  });

  it('survives the view toggle, the period arrows and Today', () => {
    const query = parseEventQuery({ hide: 'cancelled' }, TODAY);
    const html = renderToStaticMarkup(<EventToolbar query={query} clients={[]} />);
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(4);
    for (const href of links) expect(href).toContain('hide=cancelled');
    expect(hrefFor({ ...query, hideCancelled: false })).not.toContain('hide=');
  });

  it('is not part of a saved view', () => {
    const on = parseEventQuery({ hide: 'cancelled' }, TODAY);
    const off = parseEventQuery({}, TODAY);
    expect(filterSetOf(on)).toEqual(filterSetOf(off));
    expect(sameFilterSet(filterSetOf(on), filterSetOf(off))).toBe(true);
  });
});
