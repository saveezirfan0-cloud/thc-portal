// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardBooking } from '../[id]/board-data';
import { Person } from '../[id]/_components/Person';

/**
 * Every worker on the event board — confirmed, invited, applied, unavailable —
 * opens their profile from the face or the name.
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

describe('Person', () => {
  it('links the name and the face to the worker profile', () => {
    const person = { staffId: 'staff-42', name: 'Marc M.', roles: [] } as unknown as BoardBooking;
    act(() => root.render(<Person person={person} sub="Lifting and Shifting" />));

    const links = [...host.querySelectorAll('a')];
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.getAttribute('href')).toBe('/staff/staff-42');
    expect(host.querySelector('.who .n a')?.textContent).toBe('Marc M.');
    // The face is a mouse shortcut: the name is the one tab stop.
    expect(links[0]?.getAttribute('tabindex')).toBe('-1');
  });
});
