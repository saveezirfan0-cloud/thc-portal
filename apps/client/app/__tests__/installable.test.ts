import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest';
import { metadata, viewport } from '../layout';
import { config as middlewareConfig } from '../../middleware';

/**
 * The Client Portal is installable to a home screen (ADR-0052). These hold
 * the parts a browser judges, the colours against the tokens they copy, and
 * the one thing the ADR rules out: a service worker that could keep worker
 * names and photos on a shared device.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const CLIENT = join(APP, '..');
const PUBLIC = join(CLIENT, 'public');
const TOKENS = readFileSync(
  join(CLIENT, '..', '..', 'packages', 'ui', 'src', 'styles', 'tokens.css'),
  'utf8',
);

/** `--bg` inside the first block whose selector is exactly `selector`. */
function groundOf(selector: string): string {
  const at = TOKENS.indexOf(`${selector} {`);
  expect(at, `${selector} block in tokens.css`).toBeGreaterThanOrEqual(0);
  const block = TOKENS.slice(at, TOKENS.indexOf('}', at));
  const m = /--bg:\s*(#[0-9a-fA-F]{6})\s*;/.exec(block);
  expect(m, `--bg in ${selector}`).not.toBeNull();
  return m![1]!.toUpperCase();
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { w: number; h: number; opaque: boolean } {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  // Colour type 2 = RGB, 6 = RGBA. iOS paints transparency black.
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), opaque: b[25] === 2 };
}

const m = manifest();
const NAVY = groundOf(":root[data-style='warm'][data-theme='dark']");
const CREAM = groundOf(":root[data-theme='light']");

describe('web app manifest', () => {
  it('names the portal and opens standalone on the event list', () => {
    expect(m.name).toBe('THC Client Portal');
    expect(m.short_name).toBe('THC Clients');
    expect(m.start_url).toBe('/client');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m).not.toHaveProperty('prefer_related_applications');
  });

  it('takes its colours from the grounds the portal renders', () => {
    expect(NAVY).toBe('#0A0E18');
    expect(m.theme_color?.toUpperCase()).toBe(NAVY);
    expect(m.background_color?.toUpperCase()).toBe(CREAM);
  });

  it('declares a 192 and a 512 icon plus a maskable one, and each file exists at that size', () => {
    const icons = m.icons ?? [];
    const any = icons.filter((i) => (i.purpose ?? 'any') === 'any').map((i) => i.sizes);
    expect(any).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);

    for (const icon of icons) {
      const file = join(PUBLIC, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const { w, h, opaque } = pngSize(file);
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
      expect(opaque, `${icon.src} is opaque`).toBe(true);
    }
  });
});

describe('root layout', () => {
  it('links the manifest and carries the iOS home-screen tags', () => {
    expect(metadata.manifest).toBe('/manifest.webmanifest');
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      title: 'THC Clients',
      // Not black-translucent until .ctop pads for the safe-area inset.
      statusBarStyle: 'default',
    });
  });

  it('points iOS at a 180×180 opaque touch icon', () => {
    const apple = (metadata.icons as { apple: { url: string; sizes: string }[] }).apple;
    expect(apple).toEqual([
      expect.objectContaining({ url: '/apple-touch-icon.png', sizes: '180x180' }),
    ]);
    const { w, h, opaque } = pngSize(join(PUBLIC, 'apple-touch-icon.png'));
    expect([w, h, opaque]).toEqual([180, 180, true]);
  });

  it('pairs the theme colour with the manifest per colour scheme', () => {
    expect(viewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: CREAM },
      { media: '(prefers-color-scheme: dark)', color: m.theme_color },
    ]);
  });
});

describe('what the browser fetches before sign-in', () => {
  const matcher = new RegExp(`^${middlewareConfig.matcher[0]}$`);

  it('serves the manifest and the icons without the session gate', () => {
    for (const path of ['/manifest.webmanifest', '/apple-touch-icon.png', '/favicon.ico']) {
      expect(matcher.test(path), path).toBe(false);
    }
    for (const icon of m.icons ?? []) expect(matcher.test(icon.src), icon.src).toBe(false);
    expect(matcher.test('/client')).toBe(true);
  });
});

describe('no service worker (ADR-0052 §2)', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === 'node_modules' || name === '.next' || name === '__tests__') return [];
      if (statSync(p).isDirectory()) return sources(p);
      return /\.(tsx?|mjs|js)$/.test(name) ? [p] : [];
    });
  }

  it('ships no worker script and registers none', () => {
    expect(existsSync(join(PUBLIC, 'sw.js'))).toBe(false);
    expect(existsSync(join(CLIENT, 'sw.ts'))).toBe(false);
    const pkg = readFileSync(join(CLIENT, 'package.json'), 'utf8');
    expect(pkg).not.toMatch(/serwist|workbox|next-pwa/);
    for (const file of sources(CLIENT)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/serviceWorker\s*\.\s*register/);
    }
  });
});
