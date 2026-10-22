// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StaffName, StaffPhone } from '../StaffContact';

/** The §9.5 board's worker cell: name → profile (§9.6), number → tel:. */
describe('the worker on the check-in board', () => {
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

  it('shows the phone as a tel: link in the directory’s spacing', () => {
    const html = renderToStaticMarkup(<StaffPhone phone="+447519603667" />);
    expect(html).toContain('href="tel:+447519603667"');
    expect(html).toContain('+44 7519 603667');
  });

  it('draws no line when there is no phone, removed or unread', () => {
    expect(renderToStaticMarkup(<StaffPhone phone={null} />)).toBe('');
    expect(renderToStaticMarkup(<StaffPhone />)).toBe('');
  });

  it('keeps a press on the name or number from opening the violation row', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const rowClick = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <div onClick={rowClick}>
          <StaffName staffId="s1" name="Jon" />
          <StaffPhone phone="+447519603667" />
        </div>,
      ),
    );
    for (const a of container.querySelectorAll('a')) {
      a.addEventListener('click', (e) => e.preventDefault());
      act(() => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    }
    expect(container.querySelectorAll('a')).toHaveLength(2);
    expect(rowClick).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});
