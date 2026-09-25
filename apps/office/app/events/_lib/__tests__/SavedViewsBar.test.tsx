import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parseEventQuery } from '../filters';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SavedViewsBar } = await import('../SavedViewsBar');

describe('SavedViewsBar on the server', () => {
  it('renders without touching storage, with Save disabled until mounted', () => {
    const getItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn(), removeItem: vi.fn() });
    const html = renderToStaticMarkup(
      <SavedViewsBar query={parseEventQuery({}, '2026-09-25')} clients={[]} />,
    );
    expect(html).toContain('Saved views');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save view<\/button>/);
    expect(getItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
