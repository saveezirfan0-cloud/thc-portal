// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StaffName } from '../StaffName';

/** The §9.5 board's worker name: it opens the profile (§9.6). */
describe('the worker name on the check-in board', () => {
  it('links the name to the profile', () => {
    const html = renderToStaticMarkup(<StaffName staffId="s1" name="Jon Ellakuria" />);
    expect(html).toContain('href="/staff/s1"');
    expect(html).toContain('Jon Ellakuria');
  });

  it('leaves the name as text without a worker id', () => {
    const html = renderToStaticMarkup(<StaffName name="Luca M." />);
    expect(html).not.toContain('<a');
    expect(html).toContain('Luca M.');
  });

  it('keeps a press on the name from opening the violation row', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const rowClick = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <div onClick={rowClick}>
          <StaffName staffId="s1" name="Jon" />
        </div>,
      ),
    );
    const a = container.querySelector('a')!;
    a.addEventListener('click', (e) => e.preventDefault());
    act(() => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(rowClick).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});
