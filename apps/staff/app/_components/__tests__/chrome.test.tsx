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
 */
describe('the Staff App header', () => {
  it('carries the appearance switch', () => {
    const markup = renderToStaticMarkup(
      <StaffShell title="Shifts" active="/shifts">
        <span />
      </StaffShell>,
    );
    expect(markup).toContain('mode-switch');
    expect(markup).toContain('aria-label="Dark appearance"');
  });

  it('uses the icon form, so the title keeps its line at 390px', () => {
    const markup = renderToStaticMarkup(
      <StaffShell title="Autumn Partners Dinner" active="/shifts">
        <span />
      </StaffShell>,
    );
    expect(markup).toContain('Autumn Partners Dinner');
    expect(markup).not.toContain('>Light<');
  });
});
