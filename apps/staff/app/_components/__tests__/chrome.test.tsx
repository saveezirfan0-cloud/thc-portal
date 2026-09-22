import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { StaffShell } = await import('../StaffShell');

/**
 * §10.1 fixes what the phone header may spend width on — logo left, profile
 * right, title in between — so the appearance switch is the icon-only form
 * (ADR-0007). It comes from `AppHeader` itself rather than from this shell,
 * because the shift screen builds its own header and would otherwise be the
 * one screen in the app without a switch.
 *
 * `StaffShell` is an async server component: it reads the profile once and
 * applies the §10.1 app lock for every screen behind it. `renderToStaticMarkup`
 * cannot render a promise, so each case awaits the component as the function
 * it is and renders what it returns. With no Supabase configured in the test
 * environment `loadProfile()` returns null and the lock is `none`, which is
 * the unlocked chrome these two assertions are about.
 */
async function render(title: string): Promise<string> {
  const element = await StaffShell({ title, active: '/shifts', children: <span /> });
  return renderToStaticMarkup(element);
}

describe('the Staff App header', () => {
  it('carries the appearance switch', async () => {
    const markup = await render('Shifts');
    expect(markup).toContain('mode-switch');
    expect(markup).toContain('aria-label="Dark appearance"');
  });

  it('uses the icon form, so the title keeps its line at 390px', async () => {
    const markup = await render('Autumn Partners Dinner');
    expect(markup).toContain('Autumn Partners Dinner');
    expect(markup).not.toContain('>Light<');
  });
});
