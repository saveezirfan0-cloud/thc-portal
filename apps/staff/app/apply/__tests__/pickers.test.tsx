// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialCodePicker } from '../DialCodePicker';
import { DobInput } from '../DobInput';

/**
 * ADR-0064 on screen: the dialling-code picker opens, filters as you type,
 * picks with the keyboard or a tap, and submits the code; the date of birth
 * takes digits and hands the form `yyyy-mm-dd`.
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

function Dial() {
  const [code, setCode] = useState('+44');
  return (
    <form>
      <DialCodePicker name="dialCode" value={code} onChange={setCode} />
    </form>
  );
}

function Dob() {
  const [value, setValue] = useState('');
  return (
    <form>
      <DobInput label="Date of birth" name="dob" value={value} onChange={setValue} />
    </form>
  );
}

/** React listens for `input`; set the value the way the browser would. */
function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    // A date input has no caret; only text boxes take one.
    if (input.type === 'text') input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function key(el: Element, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
}

const trigger = () => host.querySelector<HTMLButtonElement>('.dial-trigger')!;
const search = () => host.querySelector<HTMLInputElement>('[role="combobox"]');
const options = () => [...host.querySelectorAll<HTMLElement>('[role="option"]')];
const submitted = (name: string) =>
  new FormData(host.querySelector('form')!).get(name) as string | null;

describe('dialling-code picker', () => {
  it('shows the short flag + code closed, and submits the code', () => {
    act(() => root.render(<Dial />));
    expect(trigger().textContent).toBe('🇬🇧 +44');
    expect(trigger().getAttribute('aria-label')).toBe('Country code: United Kingdom +44');
    expect(search()).toBeNull();
    expect(submitted('dialCode')).toBe('+44');
  });

  it('opens on a named, grouped list with the search box focused', () => {
    act(() => root.render(<Dial />));
    act(() => trigger().click());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(search());
    const groups = [...host.querySelectorAll('.dial-group')].map((g) => g.textContent);
    expect(groups).toEqual(['Common', 'All countries A–Z']);
    expect(options()[0]!.textContent).toContain('United Kingdom');
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('filters by name and picks with Enter', () => {
    act(() => root.render(<Dial />));
    act(() => trigger().click());
    type(search()!, 'france');
    expect(options()).toHaveLength(1);
    expect(host.querySelector('.dial-group')).toBeNull();
    key(search()!, 'Enter');
    expect(search()).toBeNull();
    expect(trigger().textContent).toBe('🇫🇷 +33');
    expect(submitted('dialCode')).toBe('+33');
    expect(document.activeElement).toBe(trigger());
  });

  it('moves with the arrows and picks with a tap', () => {
    act(() => root.render(<Dial />));
    act(() => trigger().click());
    type(search()!, 'ire');
    key(search()!, 'ArrowDown');
    const active = host.querySelector('.dial-option.active')!;
    expect(search()!.getAttribute('aria-activedescendant')).toBe(active.id);
    act(() => options()[0]!.click());
    expect(trigger().textContent).toBe('🇮🇪 +353');
  });

  it('says so when nothing matches, and Escape leaves the value alone', () => {
    act(() => root.render(<Dial />));
    act(() => trigger().click());
    type(search()!, 'zzzz');
    expect(host.textContent).toContain('No country matches “zzzz”');
    key(search()!, 'Escape');
    expect(search()).toBeNull();
    expect(submitted('dialCode')).toBe('+44');
  });
});

describe('date of birth', () => {
  const text = () => host.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
  const calendar = () => host.querySelector<HTMLInputElement>('input[type="date"]')!;

  it('takes digits, draws the slashes and submits yyyy-mm-dd', () => {
    act(() => root.render(<Dob />));
    expect(text().placeholder).toBe('DD/MM/YYYY');
    type(text(), '05061998');
    expect(text().value).toBe('05/06/1998');
    expect(submitted('dob')).toBe('1998-06-05');
    expect(calendar().value).toBe('1998-06-05');
  });

  it('fills the box from the calendar', () => {
    act(() => root.render(<Dob />));
    type(calendar(), '2001-12-24');
    expect(text().value).toBe('24/12/2001');
    expect(submitted('dob')).toBe('2001-12-24');
  });

  it('keeps the calendar out of the Tab order and the accessibility tree', () => {
    act(() => root.render(<Dob />));
    expect(calendar().tabIndex).toBe(-1);
    expect(calendar().getAttribute('aria-hidden')).toBe('true');
    expect(text().labels?.[0]?.textContent).toBe('Date of birth');
  });
});
