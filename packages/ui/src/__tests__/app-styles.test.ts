import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The design system is plain CSS custom properties (CLAUDE.md), which means
 * a screen can name a token that does not exist and get silence: the
 * declaration is simply dropped. That is how `--r-xs` on the application
 * confirmation badge and `--r-sm` on the rate calculator shipped as the two
 * square corners on otherwise rounded pages.
 *
 * So every `var(--…)` an app stylesheet reads has to be a property this
 * package actually defines — OR one the sheet declares itself.
 *
 * That second case is not a loophole, it is the pattern the fill chips use:
 * `events.css` sets `--accent` to a different palette token per state and
 * reads it once, which is how one rule draws four states. A locally
 * declared property is visibly present in the same file, so it cannot be
 * the silent drop this test exists to catch — a typo still is, because
 * nothing declares it anywhere.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');

const tokens = readFileSync(join(HERE, '..', 'styles', 'tokens.css'), 'utf8');
const defined = new Set([...tokens.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]!));

const sheets = globSync('apps/*/app/**/*.css', { cwd: REPO }).sort();

describe('app stylesheets read the design system', () => {
  it('finds the app stylesheets at all', () => {
    // Guards the guard: a glob that matches nothing passes vacuously.
    expect(sheets.length).toBeGreaterThan(0);
  });

  for (const sheet of sheets) {
    const css = readFileSync(join(REPO, sheet), 'utf8');

    it(`${sheet} names only tokens that exist`, () => {
      const local = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!));
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!);
      const missing = [...new Set(used)].filter((name) => !defined.has(name) && !local.has(name));
      expect(missing, `undefined in tokens.css and not declared in this sheet`).toEqual([]);
    });

    it(`${sheet} names no literal colour`, () => {
      // Data-URI marks (a select caret) are drawn, not themed; everything a
      // human sees as a colour comes from the palette.
      const withoutDataUris = css.replace(/url\("data:[^"]*"\)/g, '');
      const literals = withoutDataUris
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g);
      expect(literals ?? [], relative('.', sheet)).toEqual([]);
    });
  }
});
