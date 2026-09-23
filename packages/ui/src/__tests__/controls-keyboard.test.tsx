import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Checkbox, Radio, RadioGroup } from '../components/Controls';
import { Slider } from '../components/Input';

/**
 * D1 (§1.2). `Checkbox` and `Radio` drew the design system's square next to a
 * native input that carried `class="hide"` — and `.hide` is
 * `display: none !important`. A `display: none` input is not focusable, is not
 * in the tab order and is not in the accessibility tree, so the control could
 * only be operated with a mouse: no Tab, no Space, no arrow keys, no
 * announcement. Every form in the product uses these — /apply's GDPR consent,
 * the onboarding wizard, the compliance screens.
 *
 * The package has no DOM test environment (no jsdom, no testing-library, and
 * this fix is not allowed to add one), so these tests do not dispatch key
 * events. They assert the two things a browser needs in order to give the key
 * handling for free, which is exactly what was missing:
 *
 *   1. a real `<input type="checkbox">` / `<input type="radio">` that is
 *      rendered, not display:none and not hidden from assistive technology —
 *      that is Tab and Space;
 *   2. every radio in a group sharing one `name` inside a `radiogroup` — that
 *      is the arrow keys and the roving tab stop.
 *
 * Point 1 is a claim about the stylesheet as much as the markup, so the rule
 * that the input's class resolves to is read out of components.css here.
 */
const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');
const components = readFileSync(join(STYLES, 'components.css'), 'utf8');
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

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration block whose selector list mentions `selector`, joined. */
function declarationsFor(css: string, selector: string): string {
  const out: string[] = [];
  const clean = stripComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    if (m[1]!.split(',').some((s) => s.trim() === selector)) out.push(m[2]!.trim());
  }
  expect(out.length, `no rule for \`${selector}\``).toBeGreaterThan(0);
  return out.join(' ');
}

const attrs = (markup: string, tag: string): string[] =>
  markup.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? [];

const attr = (tagMarkup: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tagMarkup);
  if (m) return m[1]!;
  // Boolean attributes React serialises bare, e.g. `disabled`.
  return new RegExp(`\\s${name}(?=[\\s/>])`).test(tagMarkup) ? '' : null;
};

const noop = () => {};

describe('the checkbox can be reached and toggled from the keyboard (D1)', () => {
  const markup = renderToStaticMarkup(
    <Checkbox checked onChange={noop}>
      Breaks are unpaid for this client
    </Checkbox>,
  );
  const input = attrs(markup, 'input')[0]!;

  it('renders one real native checkbox', () => {
    expect(attrs(markup, 'input')).toHaveLength(1);
    expect(attr(input, 'type')).toBe('checkbox');
  });

  it('does not remove the input from the page with .hide', () => {
    // `.hide` is `display: none !important`: not focusable, not in the
    // accessibility tree. This is the bug.
    expect(attr(input, 'class')?.split(/\s+/)).not.toContain('hide');
  });

  it('is styled with a class that is invisible but still focusable', () => {
    const rule = declarationsFor(components, `.check .${attr(input, 'class')}`);
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).not.toMatch(/visibility:\s*hidden/);
    // Transparent and out of flow, so the layout next to the drawn box is
    // unchanged from `display: none`, but the element is still rendered.
    expect(rule).toMatch(/opacity:\s*0/);
    expect(rule).toMatch(/position:\s*absolute/);
  });

  it('is not hidden from assistive technology, and is not taken out of the tab order', () => {
    expect(attr(input, 'aria-hidden')).toBeNull();
    expect(attr(input, 'hidden')).toBeNull();
    expect(attr(input, 'tabindex')).toBeNull();
  });

  it('publishes its checked state on the input, not only on the drawn box', () => {
    expect(attr(input, 'checked')).not.toBeNull();
    expect(
      renderToStaticMarkup(
        <Checkbox checked={false} onChange={noop}>
          x
        </Checkbox>,
      ),
    ).not.toMatch(/<input[^>]*\schecked/);
  });

  it('gets its accessible name from the label that wraps it', () => {
    expect(markup.startsWith('<label class="check"')).toBe(true);
    expect(markup).toContain('Breaks are unpaid for this client');
    // The drawn square is decoration; it must not be announced.
    expect(markup).toMatch(/<span class="box on" aria-hidden="true">/);
  });

  it('keeps `disabled` on the input, which is what removes it from the tab order', () => {
    const off = renderToStaticMarkup(
      <Checkbox checked={false} onChange={noop} disabled>
        x
      </Checkbox>,
    );
    expect(attr(attrs(off, 'input')[0]!, 'disabled')).not.toBeNull();
  });

  it('shows the cyan focus ring on the drawn box when the input is focused', () => {
    const cls = attr(input, 'class');
    const rule = declarationsFor(components, `.check .${cls}:focus-visible + .box`);
    expect(rule).toMatch(/outline:\s*2px solid var\(--focus-line\)/);
  });
});

describe('a radio group is operable with the arrow keys (D1)', () => {
  const markup = renderToStaticMarkup(
    <RadioGroup aria-label="Student loan" name="student-loan">
      <Radio checked={false} onChange={noop}>
        Plan 1
      </Radio>
      <Radio checked onChange={noop}>
        Plan 2
      </Radio>
      <Radio checked={false} onChange={noop}>
        Plan 4
      </Radio>
    </RadioGroup>,
  );
  const inputs = attrs(markup, 'input');

  it('renders three real native radios', () => {
    expect(inputs).toHaveLength(3);
    expect(inputs.every((i) => attr(i, 'type') === 'radio')).toBe(true);
  });

  it('does not remove them from the page with .hide', () => {
    for (const i of inputs) expect(attr(i, 'class')?.split(/\s+/)).not.toContain('hide');
  });

  it('gives every radio in the group the same name, which is what the arrow keys walk', () => {
    const names = inputs.map((i) => attr(i, 'name'));
    expect(names).toEqual(['student-loan', 'student-loan', 'student-loan']);
  });

  it('names the group itself so a screen reader announces "2 of 3"', () => {
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Student loan"');
  });

  it('marks exactly the selected radio checked, so the group has one tab stop', () => {
    expect(inputs.filter((i) => attr(i, 'checked') !== null)).toHaveLength(1);
    expect(attr(inputs[1]!, 'checked')).not.toBeNull();
  });

  it('generates a shared name when the group is not given one', () => {
    const auto = attrs(
      renderToStaticMarkup(
        <RadioGroup aria-label="Unspent convictions">
          <Radio checked onChange={noop}>
            Yes
          </Radio>
          <Radio checked={false} onChange={noop}>
            No
          </Radio>
        </RadioGroup>,
      ),
      'input',
    ).map((i) => attr(i, 'name'));
    expect(auto[0]).toBeTruthy();
    expect(auto[0]).toBe(auto[1]);
  });

  it('still renders a focusable radio outside a group', () => {
    const lone = attrs(
      renderToStaticMarkup(
        <Radio checked={false} onChange={noop}>
          International student
        </Radio>,
      ),
      'input',
    )[0]!;
    expect(attr(lone, 'type')).toBe('radio');
    expect(attr(lone, 'class')?.split(/\s+/)).not.toContain('hide');
  });
});

describe('the geofence slider has the same root cause (§9.11)', () => {
  const input = attrs(
    renderToStaticMarkup(
      <Slider value={500} min={100} max={3000} onChange={noop} label="Radius" />,
    ),
    'input',
  )[0]!;

  it('is a real range input that is not display:none', () => {
    expect(attr(input, 'type')).toBe('range');
    expect(attr(input, 'class')?.split(/\s+/)).not.toContain('hide');
    const rule = declarationsFor(components, `.slider .${attr(input, 'class')}`);
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).toMatch(/opacity:\s*0/);
  });
});

describe('the wireframe stylesheet stays in sync', () => {
  it('carries the same focusable-input rule as packages/ui', () => {
    const rule = declarationsFor(wireframe, '.check .check-input');
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).toMatch(/opacity:\s*0/);
    expect(declarationsFor(wireframe, '.check .check-input:focus-visible + .box')).toMatch(
      /outline:\s*2px solid/,
    );
  });
});
