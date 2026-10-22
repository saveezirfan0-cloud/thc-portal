// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardBooking } from '../[id]/board-data';
import { HandedOver, Person } from '../[id]/_components/Person';

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

  it('links both names on a hand-over line, and only the ones with a profile', () => {
    act(() =>
      root.render(
        <HandedOver
          handover={{
            fromName: 'Grace L.',
            toName: 'Deleted account',
            fromStaffId: 'staff-1',
            toStaffId: null,
            at: '2026-09-15T23:30:00.000Z',
          }}
        />,
      ),
    );

    expect(host.textContent).toBe('Handed over: Grace L. → Deleted account · Wed 16 Sep');
    const links = [...host.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/staff/staff-1']);
  });
});
