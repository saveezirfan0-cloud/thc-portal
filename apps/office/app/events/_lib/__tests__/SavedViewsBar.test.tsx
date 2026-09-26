import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEventQuery } from '../filters';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../saved-views-actions', () => ({
  saveMyView: vi.fn(),
  deleteMyView: vi.fn(),
  moveLocalViews: vi.fn(),
  listMySavedViews: vi.fn(),
}));

const { SavedViewsBar } = await import('../SavedViewsBar');

const QUERY = parseEventQuery({}, '2026-09-25');
const CLIENT = 'aaaaaaaa-0000-4000-8000-000000000001';

afterEach(() => vi.unstubAllGlobals());

function render(initial: Parameters<typeof SavedViewsBar>[0]['initial']) {
  const getItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem, setItem: vi.fn(), removeItem: vi.fn() });
  const html = renderToStaticMarkup(<SavedViewsBar query={QUERY} clients={[]} initial={initial} />);
  return { html, getItem };
}

describe('SavedViewsBar on the server', () => {
  it('renders the account views from the database without touching storage', () => {
    const { html, getItem } = render({
      ok: true,
      views: [
        {
          id: 'row-1',
          name: 'Weddings',
          filters: { view: 'week', q: '', clientId: CLIENT, status: 'upcoming' },
        },
      ],
    });
    expect(html).toContain('Saved views');
    expect(html).toContain(
      `href="/events?view=week&amp;date=2026-09-25&amp;client=${CLIENT}&amp;status=upcoming"`,
    );
    expect(html).toContain('aria-label="Delete saved view Weddings"');
    expect(html).toMatch(/<button[^>]*>Save view<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Save view<\/button>/);
    expect(getItem).not.toHaveBeenCalled();
  });

  it('with none saved, says so and offers Save', () => {
    const { html } = render({ ok: true, views: [] });
    expect(html).toContain('None yet. Set the filters, then save them here.');
    expect(html).not.toContain('Move my saved views to my account');
  });

  it('stays up, read-only, when the database refuses', () => {
    const { html } = render({
      ok: false,
      readOnly: true,
      message: 'This login is not allowed to change saved views.',
    });
    expect(html).toContain(
      'Saved views are read-only here: This login is not allowed to change saved views.',
    );
    expect(html).not.toContain('Save view');
    expect(html).not.toContain('Delete saved view');
  });
});
