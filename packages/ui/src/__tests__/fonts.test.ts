import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The design system's five families used to arrive through
 * `@import url('https://fonts.googleapis.com/…')` at the top of tokens.css.
 * That is render-blocking on every page, it tells Google who is opening a
 * sign-in screen, and — the one that cannot be argued with — it can never
 * resolve for an installed Staff App with no connection (ADR-0001). A PWA
 * that falls back to system fonts is a PWA whose every measurement is out.
 *
 * So the woff2 subsets are checked in and the @font-face rules are ours.
 * The failure mode of that arrangement is silent in a way the CDN's was
 * not: a renamed or missing file just means no font, and the page still
 * renders. These assertions are the thing that notices.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = join(HERE, '..', 'styles');
const REPO = join(HERE, '..', '..', '..', '..');

const fonts = readFileSync(join(STYLES, 'fonts.css'), 'utf8');
const tokens = readFileSync(join(STYLES, 'tokens.css'), 'utf8');
const index = readFileSync(join(STYLES, 'index.css'), 'utf8');
const wireframe = readFileSync(join(REPO, 'wireframes', 'assets', 'thc.css'), 'utf8');

const FAMILIES = ['Space Grotesk', 'Inter', 'IBM Plex Mono', 'Outfit', 'Plus Jakarta Sans'];

const faces = [...fonts.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
const field = (face: string, name: string) =>
  face.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();

describe('self-hosted fonts', () => {
  it('declares every family the tokens name', () => {
    const declared = new Set(faces.map((f) => field(f, 'font-family')?.replace(/'/g, '')));
    for (const family of FAMILIES) expect(declared, family).toContain(family);
  });

  it('ships a file for every face, and none of them is empty', () => {
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      const url = face.match(/url\('([^']+)'\)/)?.[1];
      expect(url, field(face, 'font-family')).toBeTruthy();
      const file = resolve(STYLES, url!);
      expect(existsSync(file), url).toBe(true);
      // A 0-byte or truncated woff2 is a font that silently does not render.
      expect(statSync(file).size, url).toBeGreaterThan(4096);
    }
  });

  it('covers latin-ext as well as latin, because the workforce is not ASCII', () => {
    // latin alone stops at U+00FF: Łukasz, Zoë-with-a-caron, Öztürk all drop
    // back to system-ui mid-word.
    for (const family of FAMILIES) {
      const mine = faces.filter((f) => field(f, 'font-family') === `'${family}'`);
      const ranges = mine.map((f) => field(f, 'unicode-range') ?? '');
      expect(
        ranges.some((r) => r.includes('U+0000-00FF')),
        `${family} latin`,
      ).toBe(true);
      expect(
        ranges.some((r) => r.includes('U+0100-02BA')),
        `${family} latin-ext`,
      ).toBe(true);
    }
  });

  it('swaps rather than blocking, so text is readable while the file loads', () => {
    for (const face of faces) expect(field(face, 'font-display')).toBe('swap');
  });

  it('fetches nothing over the network, from any sheet', () => {
    for (const [name, sheet] of [
      ['fonts.css', fonts],
      ['tokens.css', tokens],
      ['index.css', index],
      ['wireframes/assets/thc.css', wireframe],
    ] as const) {
      expect(sheet, name).not.toContain('fonts.googleapis.com');
      expect(sheet, name).not.toContain('fonts.gstatic.com');
    }
  });

  it('is loaded before the tokens that name the families', () => {
    expect(index.indexOf('./fonts.css')).toBeLessThan(index.indexOf('./tokens.css'));
  });

  it('is the same sheet the wireframes use, so the two cannot drift', () => {
    expect(wireframe).toContain('packages/ui/src/styles/fonts.css');
  });
});
