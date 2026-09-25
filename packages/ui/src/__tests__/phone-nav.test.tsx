// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PhoneNav } from '../components/PhoneNav';
import type { NavItem } from '../components/Shell';

/**
 * ADR-0030: below 760px the Back Office menu is a tab bar plus a More sheet,
 * and the sheet is the only place a phone can reach the rest of the menu,
 * sign-out and the appearance switch (it closed ADR-0012's last deviation).
 * Static markup cannot open the sheet, so these drive it in a DOM.
 */
const ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', primary: true },
  { href: '/onboarding', label: 'Onboarding', count: 4, alert: true },
  { href: '/events', label: 'Scheduling', primary: true },
  { href: '/checkin', label: 'Check In / Out', short: 'Check-in', primary: true },
  { href: '/staff', label: 'Staff', dividerBefore: true },
];

function renderNav(activeHref = '/events') {
  return render(
    <PhoneNav
      items={ITEMS}
      activeHref={activeHref}
      footer={
        <>
          <span>Signed in as Sam</span>
          <button type="button">Sign out</button>
          <button type="button">Dark</button>
        </>
      }
    />,
  );
}

const more = () => screen.getByRole('button', { name: /More/ });

afterEach(cleanup);

describe('the Back Office phone menu', () => {
  it('shows the primary tabs and keeps the sheet closed until More is pressed', () => {
    renderNav();
    const bar = screen.getByRole('navigation', { name: 'Main' });
    const tabs = [...bar.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(tabs).toEqual(['/dashboard', '/events', '/checkin']);
    expect(bar.textContent).toContain('Check-in');
    expect(more().getAttribute('aria-expanded')).toBe('false');
    expect(more().hasAttribute('aria-controls')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('counts what it hides on More', () => {
    renderNav();
    expect(more().querySelector('.count.alert')?.textContent).toBe('4');
  });

  it('opens a modal sheet with the whole menu, sign-out and the appearance switch', () => {
    renderNav();
    fireEvent.click(more());
    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(more().getAttribute('aria-expanded')).toBe('true');
    expect(more().getAttribute('aria-controls')).toBe(sheet.id);
    const hrefs = [...sheet.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(ITEMS.map((item) => item.href));
    expect(sheet.textContent).toContain('Signed in as Sam');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dark' })).toBeTruthy();
    // Focus moves into the sheet, to its first item.
    expect(document.activeElement?.getAttribute('href')).toBe('/dashboard');
  });

  it('closes on Escape and hands focus back to More', () => {
    renderNav();
    fireEvent.click(more());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(more().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more());
  });

  it('keeps Tab inside the open sheet', () => {
    renderNav();
    fireEvent.click(more());
    const dark = screen.getByRole('button', { name: 'Dark' });
    dark.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement?.getAttribute('href')).toBe('/dashboard');
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(dark);
  });

  it('closes when a link in it is followed, and when the route changes', () => {
    // jsdom cannot follow a real navigation; the close is what is under test.
    const stay = (e: Event) => e.preventDefault();
    document.addEventListener('click', stay);
    const { rerender } = renderNav();
    fireEvent.click(more());
    fireEvent.click(screen.getByRole('dialog').querySelector('a[href="/staff"]')!);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(more());
    expect(screen.getByRole('dialog')).toBeTruthy();
    rerender(<PhoneNav items={ITEMS} activeHref="/staff" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    document.removeEventListener('click', stay);
  });
});
