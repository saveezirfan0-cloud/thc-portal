// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TIME_FORMAT_COOKIE } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';

import { TimeField, TimeFormatProvider, useTimeFormat } from '../components/TimeFormat';

/**
 * ADR-0085. The browser's own time input is drawn on the DEVICE's clock, so
 * on a 12-hour phone it said "5:00 PM" whatever the platform wanted. TimeField
 * is the platform's: always "HH:MM" going out, the person's clock on screen.
 */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.cookie = `${TIME_FORMAT_COOKIE}=; path=/; max-age=0`;
});

function mount(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

/** React tracks the value setter itself, so set through the prototype. */
function type(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(input: HTMLInputElement) {
  act(() => {
    input.focus();
    input.blur();
  });
}

function Harness({ format, start = '17:00' }: { format?: TimeFormat; start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <TimeField
        label="Start (UK time)"
        value={value}
        onChange={setValue}
        {...(format ? { format } : {})}
      />
      <output data-testid="out">{JSON.stringify(value)}</output>
    </>
  );
}

const input = (h: HTMLElement) => h.querySelector('input')!;
const out = (h: HTMLElement) => h.querySelector('output')!.textContent;

describe('TimeField', () => {
  it('is a plain text field, never the browser clock, and 24-hour by default', () => {
    const html = renderToStaticMarkup(
      <TimeField label="Start" value="17:00" onChange={() => {}} />,
    );
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="time"');
    expect(html).toContain('value="17:00"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('placeholder="HH:MM"');
  });

  it('shows the stored 24-hour value as 12-hour for someone who chose it', () => {
    const html = renderToStaticMarkup(
      <TimeFormatProvider format="12h">
        <TimeField label="Start" value="17:30" onChange={() => {}} />
      </TimeFormatProvider>,
    );
    expect(html).toContain('value="5:30 pm"');
    expect(html).toContain('inputMode="text"');
    expect(html).toContain('placeholder="h:mm am/pm"');
  });

  it('always hands "HH:MM" back, whichever clock is typed in', () => {
    const h = mount(<Harness format="12h" />);
    type(input(h), '9:15 pm');
    expect(out(h)).toBe('"21:15"');
    type(input(h), '0745');
    expect(out(h)).toBe('"07:45"');
    type(input(h), '12am');
    expect(out(h)).toBe('"00:00"');
  });

  it('rewrites what was typed as the clock’s own label on blur', () => {
    const h24 = mount(<Harness format="24h" start="" />);
    type(input(h24), '905');
    expect(input(h24).value).toBe('905'); // untouched while typing
    blur(input(h24));
    expect(input(h24).value).toBe('09:05');
    expect(out(h24)).toBe('"09:05"');
  });

  it('flags text that is not a time, and clears the value so a form cannot post it', () => {
    const h = mount(<Harness format="24h" />);
    type(input(h), '25:99');
    expect(out(h)).toBe('""');
    blur(input(h));
    expect(h.querySelector('.error')?.textContent).toBe('Enter a time like 17:00.');
    expect(input(h).getAttribute('aria-invalid')).toBe('true');
    type(input(h), '18:30');
    expect(h.querySelector('.error')).toBeNull();
  });

  it('says what a 12-hour person should type', () => {
    const h = mount(<Harness format="12h" />);
    type(input(h), 'late');
    blur(input(h));
    expect(h.querySelector('.error')?.textContent).toBe('Enter a time like 5:00 pm.');
  });

  it('lets the person clear it', () => {
    const h = mount(<Harness format="24h" />);
    type(input(h), '');
    blur(input(h));
    expect(out(h)).toBe('""');
    expect(h.querySelector('.error')).toBeNull();
  });
});

describe('TimeFormatProvider', () => {
  function Probe() {
    return <span>{useTimeFormat()}</span>;
  }

  it('is 24h with no provider at all', () => {
    expect(renderToStaticMarkup(<Probe />)).toBe('<span>24h</span>');
  });

  it('gives its children the clock the server read', () => {
    expect(
      renderToStaticMarkup(
        <TimeFormatProvider format="12h">
          <Probe />
        </TimeFormatProvider>,
      ),
    ).toBe('<span>12h</span>');
  });

  it('writes the cookie once when the server found the choice on the profile', () => {
    mount(
      <TimeFormatProvider format="12h" remember>
        <Probe />
      </TimeFormatProvider>,
    );
    expect(document.cookie).toContain(`${TIME_FORMAT_COOKIE}=12h`);
  });

  it('leaves the cookie alone when the server already read it from there', () => {
    const write = vi.spyOn(document, 'cookie', 'set');
    mount(
      <TimeFormatProvider format="12h">
        <Probe />
      </TimeFormatProvider>,
    );
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });
});
