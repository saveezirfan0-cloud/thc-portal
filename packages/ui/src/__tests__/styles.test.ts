import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');
const files = readdirSync(STYLES).filter((f) => f.endsWith('.css'));
const sheets = Object.fromEntries(files.map((f) => [f, readFileSync(join(STYLES, f), 'utf8')]));
const all = Object.values(sheets).join('\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = stripComments(all);

/** The `:root` block of tokens.css, i.e. the scope + dark defaults. */
function block(selector: string): string {
  const css = stripComments(sheets['tokens.css']!);
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing block ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

function token(selector: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block(selector));
  expect(match, `missing ${name} in ${selector}`).not.toBeNull();
  return match![1]!.trim();
}

describe('the handoff colour table is what ships', () => {
  const cases: [string, Record<string, string>][] = [
    [
      ':root',
      {
        '--bg': '#04080f',
        '--panel': '#0b1220',
        '--line': '#1c2839',
        '--text': '#e9eef5',
        '--muted': '#8a97a3',
        '--cyan': '#3edcec',
        '--purple': '#a879ff',
        '--green': '#3ddc97',
        '--amber': '#f5b83d',
        '--coral': '#ff6e61',
        '--canvas': '#0a0c10',
      },
    ],
    [
      ":root[data-theme='light']",
      {
        '--bg': '#faf7f4',
        '--panel': '#ffffff',
        '--line': '#ebe4da',
        '--text': '#241d16',
        '--muted': '#7a6b5c',
        '--cyan': '#0e7688',
        '--purple': '#6e45c4',
        '--green': '#1f7a4d',
        '--amber': '#b5730a',
        '--coral': '#c2402f',
        '--canvas': '#f0ebe4',
      },
    ],
    [
      ":root[data-style='warm'][data-theme='dark']",
      { '--bg': '#0a0e18', '--panel': '#171b26', '--line': '#252a36' },
    ],
  ];

  for (const [selector, expected] of cases) {
    for (const [name, value] of Object.entries(expected)) {
      it(`${selector} ${name} is ${value}`, () => {
        expect(token(selector, name)).toBe(value);
      });
    }
  }
});

describe('radius', () => {
  it('is zero everywhere in the scope style', () => {
    const scope = block(':root');
    for (const name of [
      '--r-card',
      '--r-tile',
      '--r-control',
      '--r-pill',
      '--r-track',
      '--r-avatar',
      '--r-field',
      '--r-check',
      '--r-phone',
      '--r-frame',
    ]) {
      expect(token(':root', name), name).toBe('0');
    }
    // The circular logo is the only exception (§1.6).
    expect(/--r-logo:\s*50%/.test(scope)).toBe(true);
  });

  it('follows the fluid scale in the warm style (ADR-0007)', () => {
    const warm = ":root[data-style='warm']";
    expect(token(warm, '--r-card')).toBe('28px');
    expect(token(warm, '--r-tile')).toBe('22px');
    expect(token(warm, '--r-pill')).toBe('999px');
    expect(token(warm, '--r-avatar')).toBe('50%');
    expect(token(warm, '--r-phone')).toBe('44px');
    expect(token(warm, '--r-frame')).toBe('32px');
  });

  it('pills every single-line control, and nothing that has to hold a box', () => {
    const warm = ":root[data-style='warm']";
    // Buttons, inputs, nav items and chips are all `rounded-full` on the
    // boards. A textarea and a checkbox are the two that cannot be.
    expect(token(warm, '--r-control')).toBe('999px');
    expect(token(warm, '--r-field')).toBe('20px');
    expect(token(warm, '--r-check')).toBe('8px');

    // Both exceptions are named where the component is defined, not patched
    // on in the style sheet — so scope and fluid read one rule, and the
    // difference between them stays in the token table.
    for (const name of ['--r-field', '--r-check']) {
      expect(sheets['components.css'], name).toContain(`border-radius: var(${name})`);
      expect(sheets['warm.css'], name).not.toContain(`var(${name})`);
    }
  });

  it('is never hard-coded in a component rule', () => {
    const offenders = stripComments(
      [sheets['components.css'], sheets['warm.css'], sheets['base.css'], sheets['auth.css']].join(
        '\n',
      ),
    )
      .split('\n')
      .filter((line) => /border-radius:/.test(line))
      .filter((line) => !/var\(--r-|50%|inherit/.test(line));
    expect(offenders).toEqual([]);
  });
});

describe('typography', () => {
  it('pairs Space Grotesk / Inter / IBM Plex Mono in scope', () => {
    expect(token(':root', '--font-head')).toContain('Space Grotesk');
    expect(token(':root', '--font-body')).toContain('Inter');
    expect(token(':root', '--font-mono')).toContain('IBM Plex Mono');
    expect(token(':root', '--label-case')).toBe('uppercase');
  });

  it('pairs Outfit / Plus Jakarta Sans in warm, sentence case', () => {
    const warm = ":root[data-style='warm']";
    expect(token(warm, '--font-head')).toContain('Outfit');
    expect(token(warm, '--font-body')).toContain('Plus Jakarta Sans');
    expect(token(warm, '--label-case')).toBe('none');
  });

  it('loads the five families from a sheet of our own, not from a font CDN', () => {
    // The Google Fonts `@import` that used to sit at the top of this sheet
    // was render-blocking on every page and could never resolve for an
    // installed, offline Staff App. The woff2 subsets are checked in;
    // fonts.css holds the @font-face rules and fonts.test.ts guards them.
    expect(sheets['tokens.css']).not.toContain('@import url');
    for (const sheet of Object.values(sheets)) {
      expect(sheet).not.toContain('fonts.googleapis.com');
    }
  });
});

describe('grouped and decorated inputs', () => {
  // Both of these were wrong at zero radius too; the pill scale is what made
  // them visible. They are geometry bugs, so they belong with the geometry.
  it('sizes the group from the direct child, not from the input', () => {
    // `.field` is a column flex container. `flex: 1` on a descendant input
    // applies along ITS parent's axis, which is vertical — the input
    // collapsed to its content height inside a rate field.
    expect(sheets['components.css']).toContain('.input-row > .field');
    expect(sheets['components.css']).not.toMatch(/\.input-row \.input \{\n\s*flex: 1;/);
  });

  it('anchors the search glyph to the input, not to the wrapper', () => {
    // `.search` stretches when it is a grid item, so `top: 50%` put the
    // glyph below the field.
    const start = sheets['components.css']!.indexOf('.search::before {');
    const rule = sheets['components.css']!.slice(
      start,
      sheets['components.css']!.indexOf('}', start),
    );
    expect(rule).toContain('calc(var(--input-h) / 2)');
    expect(rule).not.toMatch(/top:\s*50%/);
  });
});

describe('elevation', () => {
  it('casts no drop shadow — depth is frosted glass and accent glow', () => {
    // The handoff is explicit that nothing drops a shadow. ADR-0007 adds the
    // fluid style's glow, which is a box-shadow by mechanism but never by
    // intent: it is always the accent or the element's own colour, and never
    // a neutral cast downward. Both halves of that are worth holding.
    const shadows = rules
      .split('\n')
      .filter((line) => /box-shadow|text-shadow|drop-shadow/.test(line));

    for (const line of shadows) {
      expect(line, `neutral shadow: ${line.trim()}`).not.toMatch(
        /rgba?\(\s*0\s*,\s*0\s*,\s*0|black|#000/i,
      );
      expect(line, `untokenised shadow: ${line.trim()}`).toMatch(
        /var\(--glow-(soft|dot)\)|var\(--shadow-card\)|box-shadow:\s*none/,
      );
    }
  });

  it('casts its one shadow on the warm light ground only, and warm not black', () => {
    // A shadow is invisible on a dark ground, so dark gets glow instead and
    // this stays `none` — which is what makes the rules in warm.css inert
    // there rather than needing a second selector.
    expect(token(':root', '--shadow-card')).toBe('none');
    expect(token(":root[data-style='warm'][data-theme='dark']", '--shadow-card')).toBe('none');

    const light = token(":root[data-style='warm'][data-theme='light']", '--shadow-card');
    expect(light).not.toBe('none');
    // Warm, not neutral: a black cast on cream reads as grey dirt.
    expect(light).not.toMatch(/rgba?\(\s*0\s*,\s*0\s*,\s*0/);
    expect(light).toMatch(/rgba\(36, 29, 22/);
  });

  it('confines the glow to the fluid style, and leaves scope flat', () => {
    expect(token(':root', '--glow-soft')).toBe('none');
    expect(token(':root', '--glow-dot')).toBe('none');
    expect(token(":root[data-style='warm']", '--glow-soft')).toContain('--cyan-line');
    expect(token(":root[data-style='warm']", '--glow-dot')).toContain('currentColor');

    // Every rule that casts one lives in warm.css behind the style
    // attribute, so no screen picks up a glow just by being rendered.
    expect(
      ((sheets['warm.css'] ?? '').match(/box-shadow:\s*var\(--glow/g) ?? []).length,
    ).toBeGreaterThan(0);
    for (const other of ['components.css', 'base.css', 'auth.css', 'tokens.css']) {
      expect(sheets[other], other).not.toMatch(/box-shadow:\s*var\(--glow/);
      expect(sheets[other], other).not.toMatch(/box-shadow:\s*var\(--shadow-card/);
    }
  });

  it('frosts the mobile chrome with backdrop-filter', () => {
    for (const selector of ['.app-header', '.bottom-nav', '.sheet']) {
      const start = rules.indexOf(`${selector} {`);
      const rule = rules.slice(start, rules.indexOf('}', start));
      expect(rule, selector).toMatch(/backdrop-filter/);
    }
  });

  it('keeps the gradient primary for v2 only', () => {
    expect(token(':root', '--grad-primary')).toBe('none');
    // Dark is the handoff verbatim: its label clears 6:1 on both stops.
    expect(token(":root[data-style='warm'][data-theme='dark']", '--grad-primary')).toBe(
      'linear-gradient(135deg, #3edcec 0%, #8f7bff 100%)',
    );
    // Light deepens both stops. The handoff's #0B7A88 → #7C5CD6 puts the
    // cream label at 4.50:1 and 4.29:1; measured across the rendered sweep
    // these stops never drop below 4.66:1.
    expect(token(":root[data-style='warm'][data-theme='light']", '--grad-primary')).toBe(
      'linear-gradient(135deg, #0a6d79 0%, #7758cd 100%)',
    );
  });
});

describe('palette discipline', () => {
  it('keeps every literal colour inside tokens.css', () => {
    const others = [
      sheets['base.css'],
      sheets['components.css'],
      sheets['warm.css'],
      sheets['auth.css'],
    ].join('\n');
    const literals = stripComments(others).match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
    expect(literals).toEqual([]);
  });

  it('reserves purple for Auto-Assign', () => {
    const purpleRules = stripComments(sheets['components.css']!)
      .split(/(?=\n\.)/)
      .filter((rule) => /var\(--purple/.test(rule))
      .map((rule) => rule.trim().split('{')[0]!.trim());
    // Every purple surface is either the Auto-Assign switch, the tone
    // modifiers the design system exposes, or the Radar self-applicant flag.
    for (const selector of purpleRules) {
      expect(selector).toMatch(
        /purple|\.switch|\.kcard\.returning|\.mcard\.applied|\.card\.purple/,
      );
    }
  });
});

describe('a nav item that is not a link', () => {
  // Phase 0 renders an unbuilt route as a <span class="pending">, not an
  // <a>. Anything that lays a nav item out has to name both, or those items
  // lose their flex, padding and gap and the "soon" pill leaves the
  // sidebar. Anything that describes a *link* — hover, the active state —
  // may stay on the anchor.
  const LAYOUT = /display|flex|padding|gap|align-items|border-bottom: var\(--nav-bar\)/;

  function itemRules(prefix: string) {
    return stripComments(sheets['components.css']!)
      .split(/(?=\n\s*[.@])/)
      .filter((rule) => new RegExp(`${prefix}\\s+a[ {,]`).test(rule.split('{')[0] ?? ''));
  }

  for (const prefix of ['\\.sidebar nav', '\\.bottom-nav']) {
    it(`${prefix.replace(/\\/g, '')} lays the pending span out like the link`, () => {
      for (const rule of itemRules(prefix)) {
        const selector = rule.split('{')[0]!;
        const body = rule.slice(rule.indexOf('{'));
        if (!LAYOUT.test(body)) continue;
        expect(selector, `link-only layout rule: ${selector.trim()}`).toContain('.pending');
      }
    });
  }

  it('keeps the two navs reachable from the components that emit them', () => {
    // The class the component writes and the class the sheet styles are the
    // same one, which is what makes the rule above worth anything.
    expect(sheets['components.css']).toContain('.sidebar nav :is(a, .pending)');
    expect(sheets['components.css']).toContain('.bottom-nav :is(a, .pending)');
  });
});

describe('focus', () => {
  it('gives every interactive element a visible accent ring', () => {
    const base = stripComments(sheets['base.css']!);
    expect(base).toMatch(/:focus-visible/);
    expect(base).toMatch(/outline:\s*2px solid var\(--focus-line\)/);
    expect(token(':root', '--focus-line')).toBe('var(--cyan-ink)');
  });
});
