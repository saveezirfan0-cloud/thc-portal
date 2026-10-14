// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TileGrid } from '../components/Data';
import { Chip } from '../components/Pill';
import { Tabs } from '../components/SegToggle';
import { Content, Shell } from '../components/Shell';
import { UkDateField } from '../components/UkDateField';
import { WrongApp } from '../components/WrongApp';
import { readUkDate, typeUkDate, ukDateText, UK_DATE_FORMAT_ERROR } from '../components/ukdate';

/**
 * Release audit 14.10.2026, package G: the Back Office's keyboard and
 * screen-reader path, and the shared UK date field.
 */

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');
const css = (file: string) =>
  readFileSync(join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const wireframe = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'wireframes',
    'assets',
    'thc.css',
  ),
  'utf8',
);

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
});

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

describe('the shell: a skip link and one main landmark', () => {
  const markup = renderToStaticMarkup(
    <Shell sidebar={<aside className="sidebar">menu</aside>}>
      <Content>page</Content>
    </Shell>,
  );

  it('puts "Skip to content" before the menu, pointing at the main landmark', () => {
    expect(markup.indexOf('Skip to content')).toBeLessThan(markup.indexOf('menu'));
    expect(markup).toContain('<a class="skip-link" href="#main">Skip to content</a>');
    expect(markup).toContain('<main id="main" tabindex="-1" class="content">page</main>');
  });

  it('hides the link until it has focus, in the product and the wireframes', () => {
    const rules = css('components.css');
    expect(rules).toMatch(/\.skip-link \{[^}]*transform: translateY\(-200%\)/);
    expect(rules).toMatch(/\.skip-link:focus,\s*\.skip-link:focus-visible \{\s*transform: none;/);
    expect(wireframe).toContain('.skip-link');
  });
});

describe('tabs: one Tab stop, the arrow keys between them', () => {
  function Harness() {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('b');
    return (
      <Tabs
        aria-label="Sections"
        value={value}
        onChange={setValue}
        options={[
          { value: 'a', label: 'Overview' },
          { value: 'b', label: 'Documents' },
          { value: 'c', label: 'Shifts' },
        ]}
      />
    );
  }

  const tabs = () => [...host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const press = (key: string) =>
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });

  it('gives only the selected tab a place in the Tab order', () => {
    mount(<Harness />);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves and selects with the arrows, Home and End, wrapping at the ends', () => {
    mount(<Harness />);
    act(() => tabs()[1]!.focus());
    press('ArrowRight');
    expect(document.activeElement?.textContent).toBe('Shifts');
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true');
    press('ArrowRight');
    expect(document.activeElement?.textContent).toBe('Overview');
    press('ArrowLeft');
    expect(document.activeElement?.textContent).toBe('Shifts');
    press('Home');
    expect(document.activeElement?.textContent).toBe('Overview');
    press('End');
    expect(document.activeElement?.textContent).toBe('Shifts');
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });
});

describe('a chip says which chip its × removes', () => {
  it('names the text it carries', () => {
    const markup = renderToStaticMarkup(<Chip onRemove={() => {}}>Polish</Chip>);
    expect(markup).toContain('aria-label="Remove Polish"');
  });

  it('takes a name where the chip carries more than text', () => {
    const markup = renderToStaticMarkup(
      <Chip onRemove={() => {}} removeLabel="Remove Leonardo Hotel">
        <b>Leonardo Hotel</b> · Bar
      </Chip>,
    );
    expect(markup).toContain('aria-label="Remove Leonardo Hotel"');
  });
});

describe('a switch rings its round track, not a square box', () => {
  it('moves the focus ring onto the track', () => {
    const rules = css('components.css');
    expect(rules).toMatch(/\.switch:focus-visible \{\s*outline: none;/);
    expect(rules).toMatch(
      /\.switch:focus-visible \.track \{\s*outline: 2px solid var\(--focus-line\);/,
    );
  });
});

describe('figures in a field use the numeric face, not a fixed monospace', () => {
  it('reads --font-num with tabular numerals (Plex Mono in scope, the UI font in warm)', () => {
    expect(css('components.css')).toMatch(
      /\.input\.mono \{\s*font-family: var\(--font-num\);\s*font-variant-numeric: tabular-nums;/,
    );
    expect(css('warm.css')).toMatch(
      /:root\[data-style='warm'\] \.input\.mono \{\s*letter-spacing: normal;/,
    );
  });
});

describe('TileGrid compact', () => {
  it('marks the grid so a phone lays the KPIs two to a row', () => {
    expect(
      renderToStaticMarkup(
        <TileGrid columns={5} compact>
          {null}
        </TileGrid>,
      ),
    ).toBe('<div class="grid tilegrid c5 tiles-compact"></div>');
    expect(css('components.css')).toMatch(
      /\.grid\.tilegrid\.tiles-compact \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
  });
});

describe('UkDateField (shared, ADR-0140)', () => {
  it('reads dd/mm/yyyy, day first', () => {
    expect(readUkDate('03/04/2026')).toEqual({ value: '2026-04-03' });
    expect(readUkDate('10/16/2026')).toEqual({
      error: 'There is no month 16 — enter the date as dd/mm/yyyy.',
    });
    expect(readUkDate('16/10', true)).toEqual({ error: UK_DATE_FORMAT_ERROR });
    expect(typeUkDate('2026-10-16')).toBe('16/10/2026');
    expect(ukDateText('2026-10-16')).toBe('16/10/2026');
  });

  it('submits yyyy-mm-dd under its name from a plain form, the box showing the UK day', () => {
    const markup = renderToStaticMarkup(
      <UkDateField label="From" labelHidden name="from" defaultValue="2026-10-01" required />,
    );
    expect(markup).toContain('<label class="label sr-only"');
    expect(markup).toContain('value="01/10/2026"');
    expect(markup).toContain('<input type="hidden" name="from" value="2026-10-01"/>');
    expect(markup).toMatch(/type="text"[^>]*required=""/);
  });

  it('applies a typed day and clears a wrong one on leaving the box', () => {
    const seen: string[] = [];
    const el = mount(
      <form>
        <UkDateField label="Until" name="until" onChange={(iso) => seen.push(iso)} />
      </form>,
    );
    const box = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    const type = (text: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(box, text);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      });
    type('22/10/2026');
    expect(seen.at(-1)).toBe('2026-10-22');
    expect(el.querySelector<HTMLInputElement>('input[type="hidden"]')!.value).toBe('2026-10-22');
    type('22/13/2026');
    act(() => {
      box.focus();
      box.blur();
    });
    expect(el.querySelector('.error')?.textContent).toBe(
      'There is no month 13 — enter the date as dd/mm/yyyy.',
    );
    expect(seen.at(-1)).toBe('');
  });

  it('draws its classes in the product and the wireframes', () => {
    expect(css('components.css')).toContain('.ukd-row .ukd-native {');
    expect(wireframe).toContain('.ukd-row');
  });
});

describe('the wrong-app page is the sign-in card', () => {
  it('has the logo, the company, the app, the reason and a POST sign-out', () => {
    const markup = renderToStaticMarkup(
      <WrongApp
        product="Client Portal"
        title="This account is not for the Client Portal"
        body="You are signed in to a Back Office account. Sign out and use the account for this app."
      />,
    );
    expect(markup).toContain('class="logo lg"');
    expect(markup).toContain('The Hospitality Company');
    expect(markup).toContain('<h2>This account is not for the Client Portal</h2>');
    expect(markup).toContain('<form class="signout" action="/auth/signout" method="post">');
    expect(markup).toContain('>Sign out</button>');
  });
});
