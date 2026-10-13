// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StaffRoles } from '../[id]/_components/StaffRoles';

/**
 * The roles under a name on the event board: a count that opens the list in
 * a dialog, so a worker with twenty roles does not take four lines.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ROLES = ['Bar Staff', 'Barista', 'Runner', 'Waiting Staff'];

describe('StaffRoles', () => {
  it('shows a count, not the list, until pressed', () => {
    act(() => root.render(<StaffRoles name="Eyad A." roles={ROLES} roleName="Waiting Staff" />));
    expect(host.textContent).toBe('4 roles');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens a dialog listing every role, marking this section', () => {
    act(() => root.render(<StaffRoles name="Eyad A." roles={ROLES} roleName="Waiting Staff" />));
    act(() => host.querySelector('button')!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Eyad A. · 4 roles');
    const chips = [...dialog.querySelectorAll('.role-chips .chip')];
    expect(chips.map((c) => c.textContent)).toEqual(ROLES);
    expect(chips.filter((c) => c.classList.contains('cyan')).map((c) => c.textContent)).toEqual([
      'Waiting Staff',
    ]);

    act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps one role, or none recorded, as plain text', () => {
    act(() => root.render(<StaffRoles name="Kumar A." roles={['Runner']} roleName="Runner" />));
    expect(host.textContent).toBe('Runner');
    expect(host.querySelector('button')).toBeNull();

    act(() => root.render(<StaffRoles name="Kumar A." roles={[]} roleName="Waiting Staff" />));
    expect(host.textContent).toBe('Waiting Staff');
  });
});
