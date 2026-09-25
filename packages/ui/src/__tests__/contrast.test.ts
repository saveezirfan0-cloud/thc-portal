import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'tokens.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing block ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}
function token(selector: string, name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(block(selector));
  expect(m, `missing ${name} in ${selector}`).not.toBeNull();
  return m![1]!.trim();
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (pair: string) => {
    const v = parseInt(pair, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(h.slice(0, 2)) +
    0.7152 * channel(h.slice(2, 4)) +
    0.0722 * channel(h.slice(4, 6))
  );
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The grounds come from the supplied spec; the foreground tones do not,
 * because the spec's own light palette fails AA against its own page —
 * cyan 3.45:1, emerald 2.38:1, amber 2.01:1, coral 3.44:1, muted 4.46:1.
 *
 * This is the guard on that split. It measures, rather than trusting the
 * comment in tokens.css, so swapping a ground or an ink re-checks the pair.
 */
describe('every text tone clears AA on every ground it is drawn on', () => {
  const AA = 4.5;

  it('holds on the warm light grounds', () => {
    const light = ":root[data-theme='light']";
    const grounds = (['--bg', '--panel', '--panel-2'] as const).map((n) => token(light, n));
    const inks = (
      [
        '--text',
        '--muted',
        '--cyan-ink',
        '--purple-ink',
        '--green-ink',
        '--amber-ink',
        '--coral-ink',
      ] as const
    ).map((n) => token(light, n));

    for (const ground of grounds) {
      for (const ink of inks) {
        expect(contrast(ink, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('holds on the fluid dark grounds', () => {
    const dark = ":root[data-style='warm'][data-theme='dark']";
    const grounds = (['--bg', '--panel', '--panel-2'] as const).map((n) => token(dark, n));
    // The dark accents live in the base block; only the grounds move.
    const inks = (
      ['--text', '--muted', '--cyan', '--purple', '--green', '--amber', '--coral'] as const
    ).map((n) => token(':root', n));

    for (const ground of grounds) {
      for (const ink of inks) {
        expect(contrast(ink, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('keeps a disabled control readable in every theme', () => {
    // Disabled is a flat surface with a muted label, not a fade (the old
    // 55% opacity is what made "Save rota guard" look broken). WCAG exempts
    // disabled controls from contrast; this system does not, because a
    // manager still has to read what the button would do.
    const themes: [string, string][] = [
      ['scope dark', ':root'],
      ['light', ":root[data-theme='light']"],
      ['fluid dark', ":root[data-style='warm'][data-theme='dark']"],
    ];
    for (const [name, selector] of themes) {
      const ink = token(selector, '--disabled-ink');
      const surface = token(selector, '--disabled-bg');
      expect(contrast(ink, surface), `${name}: ${ink} on ${surface}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('rejects the spec’s own light foregrounds, which is why they were not taken', () => {
    const page = token(":root[data-theme='light']", '--bg');
    for (const failing of ['#0891b2', '#10b981', '#f59e0b', '#f43f5e', '#64748b']) {
      expect(contrast(failing, page), `${failing} on ${page}`).toBeLessThan(AA);
    }
  });
});
