// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TableScroll } from '../components/Table';

/**
 * ADR-0136. jsdom has no layout, so the widths the frame measures are
 * stubbed on the prototype: `wide` decides whether the table overflows.
 */
let wide = false;
let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('tbl-scroll') && wide ? 1200 : 800;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
  });
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

const table = (
  <table className="tbl">
    <thead>
      <tr>
        <th>Venue</th>
        <th className="cell-actions">Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Leonardo Royal Hotel</td>
        <td className="cell-actions">
          <button type="button">Edit</button>
        </td>
      </tr>
    </tbody>
  </table>
);

describe('TableScroll (ADR-0136)', () => {
  it('renders the frame, its scroller and the scrollbar twin', () => {
    const markup = renderToStaticMarkup(
      <TableScroll label="Venues" minWidth="52rem" fixed>
        {table}
      </TableScroll>,
    );
    expect(markup).toMatch(/^<div class="tbl-frame fixed" style="--tbl-min:52rem">/);
    expect(markup).toContain('<div class="tbl-scroll" role="region" aria-label="Venues">');
    expect(markup).toContain('<div class="tbl-hbar" aria-hidden="true"><div></div>');
  });

  it('marks a table that fits, and leaves it out of the tab order', () => {
    wide = false;
    act(() => root.render(<TableScroll label="Venues">{table}</TableScroll>));
    const frame = host.querySelector('.tbl-frame')!;
    expect(frame.hasAttribute('data-fit')).toBe(true);
    expect(frame.hasAttribute('data-overflow')).toBe(false);
    expect(host.querySelector('.tbl-scroll')!.hasAttribute('tabindex')).toBe(false);
  });

  it('marks a table wider than its card, shows more to the right and takes focus', () => {
    wide = true;
    act(() => root.render(<TableScroll label="Venues">{table}</TableScroll>));
    const frame = host.querySelector<HTMLElement>('.tbl-frame')!;
    expect(frame.hasAttribute('data-overflow')).toBe(true);
    expect(frame.hasAttribute('data-more-end')).toBe(true);
    expect(frame.hasAttribute('data-more-start')).toBe(false);
    expect(host.querySelector('.tbl-scroll')!.getAttribute('tabindex')).toBe('0');
    // The twin's track is as wide as the table, so its thumb matches.
    expect(host.querySelector<HTMLElement>('.tbl-hbar > div')!.style.width).toBe('1200px');
  });

  it('pins a lead cell and the name with pin={2}, and keeps the twin out of the tab order', () => {
    wide = true;
    act(() => root.render(<TableScroll pin={2}>{table}</TableScroll>));
    expect(host.querySelector('.tbl-frame')!.classList.contains('pin-2')).toBe(true);
    expect(host.querySelector('.tbl-hbar')!.getAttribute('tabindex')).toBe('-1');
  });

  it('sticks the header under a sticky top bar', () => {
    wide = false;
    const bar = document.createElement('header');
    bar.className = 'topbar';
    bar.style.position = 'sticky';
    bar.getBoundingClientRect = () => ({ height: 64 }) as DOMRect;
    document.body.prepend(bar);
    act(() => root.render(<TableScroll>{table}</TableScroll>));
    const frame = host.querySelector<HTMLElement>('.tbl-frame')!;
    expect(frame.style.getPropertyValue('--tbl-top')).toBe('64px');
  });
});
