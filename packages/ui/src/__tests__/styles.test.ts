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
        '--bg': '#f6f1ea',
        '--panel': '#fffcf7',
        '--line': '#e2d6c7',
        '--text': '#241d16',
        '--muted': '#7a6b5c',
        '--cyan': '#0b7a88',
        '--purple': '#6e45c4',
        '--green': '#1f7a4d',
        '--amber': '#b5730a',
        '--coral': '#c2402f',
        '--canvas': '#ede6dc',
      },
    ],
    [
      ":root[data-style='warm'][data-theme='dark']",
      { '--bg': '#070c16', '--panel': '#111a2b', '--line': '#28354c' },
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
      '--r-phone',
      '--r-frame',
    ]) {
      expect(token(':root', name), name).toBe('0');
    }
    // The circular logo is the only exception (§1.6).
    expect(/--r-logo:\s*50%/.test(scope)).toBe(true);
  });

  it('follows the v2 scale in the warm style', () => {
    const warm = ":root[data-style='warm']";
    expect(token(warm, '--r-card')).toBe('20px');
    expect(token(warm, '--r-tile')).toBe('18px');
    expect(token(warm, '--r-control')).toBe('14px');
    expect(token(warm, '--r-pill')).toBe('999px');
    expect(token(warm, '--r-avatar')).toBe('50%');
    expect(token(warm, '--r-phone')).toBe('44px');
    expect(token(warm, '--r-frame')).toBe('24px');
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

  it('loads all five families', () => {
    const importLine = sheets['tokens.css']!.split('\n').find((l) => l.startsWith('@import url'))!;
    for (const family of [
      'Space+Grotesk',
      'Inter',
      'IBM+Plex+Mono',
      'Outfit',
      'Plus+Jakarta+Sans',
    ]) {
      expect(importLine).toContain(family);
    }
  });
});

describe('elevation', () => {
  it('uses no drop shadows anywhere — the handoff is explicit about it', () => {
    const shadows = rules.split('\n').filter((line) => /box-shadow|text-shadow|drop-shadow/.test(line));
    expect(shadows).toEqual([]);
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
    expect(token(":root[data-style='warm'][data-theme='dark']", '--grad-primary')).toBe(
      'linear-gradient(135deg, #3edcec 0%, #8f7bff 100%)',
    );
    expect(token(":root[data-style='warm'][data-theme='light']", '--grad-primary')).toBe(
      'linear-gradient(135deg, #0b7a88 0%, #7c5cd6 100%)',
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

describe('focus', () => {
  it('gives every interactive element a visible accent ring', () => {
    const base = stripComments(sheets['base.css']!);
    expect(base).toMatch(/:focus-visible/);
    expect(base).toMatch(/outline:\s*2px solid var\(--focus-line\)/);
    expect(token(':root', '--focus-line')).toBe('var(--cyan-ink)');
  });
});
