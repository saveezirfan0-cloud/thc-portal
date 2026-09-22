import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AppChrome } = await import('../AppChrome');

/**
 * §10.1 fixes what the phone header may spend width on — logo left, profile
 * right, title in between — so the appearance switch is the icon-only form
 * (ADR-0007). It comes from `AppHeader` itself rather than from this shell,
 * because the shift screen builds its own header and would otherwise be the
 * one screen in the app without a switch.
 *
 * Renders `AppChrome` rather than `StaffShell`, which is what this asserted
 * when #42 wrote it. `StaffShell` became async when the app-wide §10.1 lock
 * landed — it loads the worker to decide which tabs are reachable — and
 * `renderToStaticMarkup` is synchronous, so it now throws "a component
 * suspended while responding to synchronous input" rather than failing on
 * the switch. AppChrome is the header, is what every StaffShell screen
 * renders, and is synchronous. The guarantee is unchanged and is if anything
 * closer to the one the comment above describes: the switch comes from
 * `AppHeader`, and this proves the app's chrome asks for it.
 */
describe('the Staff App header', () => {
  it('carries the appearance switch', () => {
    const markup = renderToStaticMarkup(<AppChrome title="Shifts" worker={null} />);
    expect(markup).toContain('mode-switch');
    expect(markup).toContain('aria-label="Dark appearance"');
  });

  it('uses the icon form, so the title keeps its line at 390px', () => {
    const markup = renderToStaticMarkup(<AppChrome title="Autumn Partners Dinner" worker={null} />);
    expect(markup).toContain('Autumn Partners Dinner');
    expect(markup).not.toContain('>Light<');
  });
});
