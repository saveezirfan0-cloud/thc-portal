/**
 * What the service worker downloads ahead of time (go-live audit M4,
 * ADR-0162). Used by next.config.ts at build time; pure, so it is tested
 * without a build.
 *
 * Left to itself, @serwist/next precaches every file the client build
 * emits: every route's chunks (/apply, /activate, all eleven onboarding
 * steps, every profile sub-page), the Pages Router's framework and
 * polyfills, which an App Router page never loads, and every font file,
 * whatever the page needs. That was 115 entries, about 2 MB raw
 * (~840 KB gzipped), fetched in the background by every phone on its
 * first visit and again for whatever changed after each deploy, on venue
 * signal, alongside the check-in request.
 *
 * Now only these are precached:
 *
 *   · the App Router runtime (`main-app`: webpack's runtime, React and
 *     React DOM, Next's client), which every page needs;
 *   · the root layout and its error and not-found boundaries;
 *   · the working tabs a worker opens on shift (`/`, `/shifts`,
 *     `/shifts/[id]`, `/invites`, `/radar`, `/documents`) and their
 *     loading skeletons;
 *   · `/offline`, the shell the worker serves when the network is gone.
 *     The page itself is added in next.config.ts; its chunks are here.
 *
 * Only the JavaScript and CSS of those, no fonts. Every other `_next/static` file
 * (a font, the upload screens, onboarding, the profile sub-pages) loads
 * when it is first used and is then kept by the worker's cache-first rule
 * for build files (sw.ts). Those files are content-hashed and never
 * change under a URL, so "cache first" cannot serve a stale one.
 *
 * Fonts are not precached because a browser fetches only the subsets a
 * page draws (`unicode-range`). Precaching all twelve files fetched the
 * Latin Extended and IBM Plex Mono faces for every phone. Offline, a font
 * the browser has not loaded falls back to the system face
 * (`font-display: swap`), and the offline shell stays readable.
 */

/**
 * Next's client entry names: `app/<route>/page`, as in
 * `.next/app-build-manifest.json`, prefixed `app/`. `main-app` is the App
 * Router's runtime entry (the build manifest's `rootMainFiles`).
 */
export const PRECACHED_ENTRIES = [
  'main-app',
  'app/layout',
  'app/error',
  'app/not-found',
  'app/page',
  'app/shifts/page',
  'app/shifts/loading',
  'app/shifts/[id]/page',
  'app/invites/page',
  'app/invites/loading',
  'app/radar/page',
  'app/radar/loading',
  'app/documents/page',
  'app/documents/loading',
  'app/offline/page',
] as const;

/** Only scripts and stylesheets are precached; fonts and images load when used. */
const PRECACHED_FILE = /\.(?:js|css)$/i;

/** The parts of a webpack `Compilation` this reads, so no webpack types are needed. */
export interface CompilationLike {
  namedChunkGroups: {
    get(name: string): { chunks: Iterable<{ files: Iterable<string> }> } | undefined;
  };
  options: { output: { publicPath?: unknown } };
}

export interface ManifestEntryLike {
  url: string;
  revision?: string | null;
  size: number;
}

/**
 * The asset names (`static/chunks/…`) of the named entries' scripts and
 * stylesheets.
 *
 * A name the build does not have FAILS THE BUILD. If Next renames its
 * entries in an upgrade, or a route here moves, a warning would leave the
 * precache quietly holding nothing but /offline, with no shell to render
 * it. A failed build is the louder signal.
 */
export function precachedAssetNames(
  compilation: CompilationLike,
  entries: readonly string[] = PRECACHED_ENTRIES,
): Set<string> {
  const names = new Set<string>();
  const missing: string[] = [];
  for (const entry of entries) {
    const group = compilation.namedChunkGroups.get(entry);
    if (!group) {
      missing.push(entry);
      continue;
    }
    for (const chunk of group.chunks) {
      for (const file of chunk.files) if (PRECACHED_FILE.test(file)) names.add(file);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[sw-precache] the client build has no entry named ${missing.join(', ')}. ` +
        'Update PRECACHED_ENTRIES in apps/staff/lib/sw-precache.ts to match the routes ' +
        '(see .next/app-build-manifest.json).',
    );
  }
  return names;
}

/**
 * A Serwist `manifestTransforms` step: keep only the entries whose file
 * `precachedAssetNames()` names. Runs before @serwist/next's own URL
 * clean-up, so an entry's URL is still `<publicPath><asset name>`, with
 * `[id]` unescaped.
 */
export function precacheWorkingTabs(entries: readonly string[] = PRECACHED_ENTRIES) {
  return async <E extends ManifestEntryLike>(
    manifest: E[],
    compilation?: unknown,
  ): Promise<{ manifest: E[]; warnings: string[] }> => {
    if (!compilation) {
      throw new Error('[sw-precache] expected the webpack compilation as the transform parameter.');
    }
    const keep = precachedAssetNames(compilation as CompilationLike, entries);
    const publicPath = String((compilation as CompilationLike).options.output.publicPath ?? '');
    return {
      manifest: manifest.filter((entry) => {
        const name = entry.url.startsWith(publicPath)
          ? entry.url.slice(publicPath.length)
          : entry.url;
        return keep.has(name);
      }),
      warnings: [],
    };
  };
}
