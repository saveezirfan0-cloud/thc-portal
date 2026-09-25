// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { BottomTabs } = await import('../BottomTabs');

/**
 * The bottom navigation's accessible names. The active tab is lit in cyan
 * AND announced as the current page; the landmark is named so it is not
 * one of several anonymous "navigation"s.
 */
const TABS = [
  { href: '/shifts', label: 'Shifts' },
  { href: '/invites', label: 'Invites' },
  { href: '/radar', label: 'Radar' },
  { href: '/profile', label: 'Profile' },
];

function doc(markup: string): Document {
  return new DOMParser().parseFromString(markup, 'text/html');
}

describe('BottomTabs', () => {
  it('names the landmark', () => {
    const d = doc(renderToStaticMarkup(<BottomTabs tabs={TABS} active="/shifts" />));
    expect(d.querySelector('nav.bottom-nav')?.getAttribute('aria-label')).toBe('Main');
  });

  it('marks only the active tab aria-current="page"', () => {
    const d = doc(renderToStaticMarkup(<BottomTabs tabs={TABS} active="/radar" />));
    const current = [...d.querySelectorAll('[aria-current]')];
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('aria-current')).toBe('page');
    expect(current[0]?.getAttribute('href')).toBe('/radar');
    expect(current[0]?.classList.contains('active')).toBe(true);
  });

  it('marks no tab current when none is active', () => {
    const d = doc(renderToStaticMarkup(<BottomTabs tabs={TABS} />));
    expect(d.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('still marks a locked tab current when it is the one open', () => {
    const tabs = TABS.map((t) => ({ ...t, locked: t.href !== '/profile' }));
    const d = doc(renderToStaticMarkup(<BottomTabs tabs={tabs} active="/shifts" />));
    const current = d.querySelector('[aria-current="page"]');
    expect(current?.tagName).toBe('SPAN');
    expect(current?.getAttribute('aria-disabled')).toBe('true');
  });
});
