import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRECACHED_ENTRIES,
  precacheWorkingTabs,
  precachedAssetNames,
  type CompilationLike,
} from '../sw-precache';

/**
 * Go-live audit M4 · the service worker precaches the working tabs, not
 * the whole app. Every other build file loads when it is first used and
 * is then kept cache-first (sw.ts; the routing is pinned in sw.test.ts).
 */

function compilation(groups: Record<string, string[][]>, publicPath = '/_next/'): CompilationLike {
  const map = new Map(
    Object.entries(groups).map(([name, chunks]) => [
      name,
      { chunks: chunks.map((files) => ({ files: new Set(files) })) },
    ]),
  );
  return { namedChunkGroups: map, options: { output: { publicPath } } };
}

/** A build with every entry we name, plus routes and assets we do not. */
function fullBuild() {
  const groups: Record<string, string[][]> = {};
  for (const name of PRECACHED_ENTRIES) {
    groups[name] = [
      ['static/chunks/webpack-1.js'],
      [`static/chunks/${name}-1.js`, `static/css/${name.replace(/\W/g, '_')}.css`],
    ];
  }
  groups['main-app']!.push(['static/chunks/react-dom-1.js']);
  groups['app/layout']!.push(['static/media/inter-latin.woff2', 'static/chunks/layout-x.js.map']);
  groups['app/apply/page'] = [
    ['static/chunks/app/apply/page-1.js', 'static/chunks/8269-supabase.js'],
  ];
  groups['main'] = [['static/chunks/main-1.js', 'static/chunks/framework-1.js']];
  return compilation(groups);
}

const entry = (url: string) => ({ url, revision: null, size: 1 });

describe('precachedAssetNames', () => {
  it('names the scripts and stylesheets of the working tabs, the runtime and /offline', () => {
    const names = precachedAssetNames(fullBuild());
    expect(names).toContain('static/chunks/webpack-1.js');
    expect(names).toContain('static/chunks/react-dom-1.js');
    expect(names).toContain('static/chunks/app/shifts/[id]/page-1.js');
    expect(names).toContain('static/chunks/app/offline/page-1.js');
    expect(names).toContain('static/css/app_documents_page.css');
  });

  it('leaves out fonts, source maps, other routes and the Pages Router framework', () => {
    const names = precachedAssetNames(fullBuild());
    expect(names).not.toContain('static/media/inter-latin.woff2');
    expect(names).not.toContain('static/chunks/layout-x.js.map');
    expect(names).not.toContain('static/chunks/app/apply/page-1.js');
    expect(names).not.toContain('static/chunks/8269-supabase.js');
    expect(names).not.toContain('static/chunks/framework-1.js');
  });

  it('fails the build when an entry it names is gone, rather than precaching nothing', () => {
    expect(() =>
      precachedAssetNames(compilation({ 'main-app': [['static/chunks/a.js']] }), [
        'main-app',
        'app/radar/page',
      ]),
    ).toThrow(/no entry named app\/radar\/page/);
  });

  it('covers exactly the tabs a worker opens on shift, and /offline', () => {
    expect([...PRECACHED_ENTRIES].filter((e) => e.endsWith('/page')).sort()).toEqual(
      [
        'app/page',
        'app/shifts/page',
        'app/shifts/[id]/page',
        'app/invites/page',
        'app/radar/page',
        'app/documents/page',
        'app/offline/page',
      ].sort(),
    );
  });
});

describe('precacheWorkingTabs (the manifest transform)', () => {
  it('keeps only the named files, matching on the URL the build gave them', async () => {
    const transform = precacheWorkingTabs();
    const { manifest } = await transform(
      [
        entry('/_next/static/chunks/app/shifts/[id]/page-1.js'),
        entry('/_next/static/chunks/app/apply/page-1.js'),
        entry('/_next/static/media/inter-latin.woff2'),
        entry('/_next/static/chunks/main-app-1.js'),
        entry('/_next/static/chunks/framework-1.js'),
      ],
      fullBuild(),
    );
    expect(manifest.map((e) => e.url)).toEqual([
      '/_next/static/chunks/app/shifts/[id]/page-1.js',
      '/_next/static/chunks/main-app-1.js',
    ]);
  });

  it('works under an asset prefix', async () => {
    const build = compilation(
      Object.fromEntries(PRECACHED_ENTRIES.map((n) => [n, [[`static/chunks/${n}.js`]]])),
      'https://cdn.example/_next/',
    );
    const { manifest } = await precacheWorkingTabs()(
      [entry('https://cdn.example/_next/static/chunks/app/radar/page.js')],
      build,
    );
    expect(manifest).toHaveLength(1);
  });

  it('refuses to run without the compilation', async () => {
    await expect(precacheWorkingTabs()([entry('/x.js')])).rejects.toThrow(/compilation/);
  });
});

/**
 * Against a real `next build`, when there is one in the tree (CI builds
 * after it tests, so this usually runs on a developer's machine after a
 * build). It reads the manifest injected into public/sw.js and the build's
 * own app-build-manifest.json.
 */
const APP = join(__dirname, '..', '..');
const SW = join(APP, 'public', 'sw.js');
const BUILD_MANIFEST = join(APP, '.next', 'app-build-manifest.json');
const built = existsSync(SW) && existsSync(BUILD_MANIFEST);

function precachedUrls(): string[] {
  const sw = readFileSync(SW, 'utf8');
  const start = sw.indexOf('precacheEntries:[');
  const list = sw.slice(start, sw.indexOf(']', start));
  return [...list.matchAll(/['"]?url['"]?:\s*['"]([^'"]+)['"]/g)].map((m) =>
    decodeURIComponent(m[1]!),
  );
}

describe.skipIf(!built)('the built public/sw.js', () => {
  it('is from this build: every precached file exists in .next/static', () => {
    for (const url of precachedUrls()) {
      if (url === '/offline') continue;
      expect([url, existsSync(join(APP, '.next', url.replace(/^\/_next\//, '')))]).toEqual([
        url,
        true,
      ]);
    }
  });

  it('precaches /offline and everything its first paint loads, so the fallback renders', () => {
    const pages = (
      JSON.parse(readFileSync(BUILD_MANIFEST, 'utf8')) as { pages: Record<string, string[]> }
    ).pages;
    const urls = new Set(precachedUrls());
    expect(urls).toContain('/offline');
    for (const route of [
      '/layout',
      '/offline/page',
      '/shifts/page',
      '/shifts/[id]/page',
      '/radar/page',
    ]) {
      for (const file of pages[route] ?? []) {
        expect([route, file, urls.has(`/_next/${file}`)]).toEqual([route, file, true]);
      }
    }
  });

  it('leaves the onboarding, upload and apply routes to load on demand', () => {
    const urls = precachedUrls();
    expect(urls.length).toBeLessThan(60);
    expect(urls.some((u) => /\/app\/(apply|activate|onboarding|profile)\//.test(u))).toBe(false);
    expect(urls.some((u) => /\/app\/documents\/upload\//.test(u))).toBe(false);
    expect(urls.some((u) => /\.woff2$/.test(u))).toBe(false);
  });
});
