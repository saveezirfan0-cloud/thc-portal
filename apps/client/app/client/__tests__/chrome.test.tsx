import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `prefetch` is a next/link prop, not a DOM attribute, so the stand-in has
// to swallow it rather than hand React a boolean it will complain about.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The bar's identity block needs a session; this test is about the chrome,
// not about who is in it. With no project configured the layout takes its
// own "not signed in" path and never reaches Supabase.
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));
vi.mock('../data', () => ({ supabaseConfigured: () => false }));

const ClientPortalLayout = (await import('../layout')).default;
const { ViewerZoneNote } = await import('../../_components/ViewerZoneNote');

/**
 * The top bar is the whole of the Client Portal's chrome (§11.1: top bar,
 * no sidebar). If the appearance switch is not in it, a customer has no way
 * to reach it at all — ADR-0007 promises one user-facing switch.
 */
describe('the Client Portal top bar', () => {
  it('carries the appearance switch', async () => {
    const markup = renderToStaticMarkup(await ClientPortalLayout({ children: <span /> }));
    expect(markup).toContain('aria-label="Appearance"');
    expect(markup).toContain('>Light<');
    expect(markup).toContain('>Dark<');
  });

  it('still shows the sign-out link beside it', async () => {
    const markup = renderToStaticMarkup(await ClientPortalLayout({ children: <span /> }));
    expect(markup).toContain('Sign out');
  });
});

describe('landmarks (WCAG 1.3.1, 2.4.1)', () => {
  it('opens on "Skip to content", the first focusable element, pointing at the <main>', async () => {
    const markup = renderToStaticMarkup(await ClientPortalLayout({ children: <span /> }));
    const first = markup.match(/<(a|button|input|select|textarea)\b[^>]*>/)?.[0];
    expect(first).toBe('<a class="skip-link" href="#main">');
    expect(markup).toContain('>Skip to content</a>');
    expect(markup).toContain('<main id="main" class="cwrap" tabindex="-1"><span></span></main>');
    expect(markup.match(/<main\b/g)).toHaveLength(1);
  });

  it('gives every signed-out page, the error and the 404 one <main>', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const app = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    for (const seg of ['login', 'forgot', 'reset', 'auth']) {
      const layout = join(app, seg, 'layout.tsx');
      expect(existsSync(layout), `${seg}/layout.tsx`).toBe(true);
      expect(readFileSync(layout, 'utf8')).toContain('<AuthMain>');
    }
    for (const file of ['error.tsx', 'not-found.tsx']) {
      expect(readFileSync(join(app, file), 'utf8'), file).toContain('<AuthMain>');
    }
    const { AuthMain } = await import('../../_components/AuthMain');
    expect(renderToStaticMarkup(<AuthMain>x</AuthMain>)).toBe('<main id="main">x</main>');
  });
});

describe('the viewer-zone note (wireframes/client/events.html)', () => {
  it('names the zone and its offset for a reader outside UK time', () => {
    const markup = renderToStaticMarkup(<ViewerZoneNote zone="Europe/Berlin" />);
    expect(markup).toMatch(/^<span class="tz">Viewer: Europe\/Berlin \(UTC\+[12]\)<\/span>$/);
  });

  it('says nothing to a reader on UK time, the Crown Dependencies included', () => {
    for (const zone of ['Europe/London', 'Europe/Jersey', 'Europe/Isle_of_Man', 'GB']) {
      expect(renderToStaticMarkup(<ViewerZoneNote zone={zone} />)).toBe('');
    }
  });

  it('is absent from the server-rendered bar, which cannot know the zone', async () => {
    const markup = renderToStaticMarkup(await ClientPortalLayout({ children: <span /> }));
    expect(markup).not.toContain('class="tz"');
  });

  it('ends the menu on Account then Sign out, the pair the phone panel draws full width', async () => {
    const markup = renderToStaticMarkup(await ClientPortalLayout({ children: <span /> }));
    const menu = markup.slice(markup.indexOf('id="client-account"'));
    expect(menu.indexOf('aria-label="Appearance"')).toBeLessThan(menu.indexOf('>Account<'));
    expect(menu.indexOf('>Account<')).toBeLessThan(menu.indexOf('Sign out'));
  });
});
