import { unstable_isUnrecognizedActionError } from 'next/navigation';

/**
 * A server action that rejected because the phone is running an older
 * build than the server (go-live audit B5).
 *
 * Next gives every server action a new id on each build. A phone kept awake
 * on the shift screen since before a deploy calls the old ids, and the
 * server answers "not found" — every press and every ping fails until the
 * page is loaded again. The only cure on the phone is that reload.
 *
 * The class name is checked as well as Next's helper: the helper is marked
 * unstable, and the error sets `name` explicitly, so it survives
 * minification.
 */
export function isStaleDeploy(error: unknown): boolean {
  try {
    if (
      typeof unstable_isUnrecognizedActionError === 'function' &&
      unstable_isUnrecognizedActionError(error)
    ) {
      return true;
    }
  } catch {
    // An older or mocked `next/navigation` without the helper.
  }
  return error instanceof Error && error.name === 'UnrecognizedActionError';
}

const RELOADED_AT = 'thc:stale-deploy-reload';
/** Never more than one automatic reload in this long, so a broken deploy cannot loop. */
export const RELOAD_GUARD_MS = 60_000;

/**
 * Reload onto the current build, at most once a minute. Answers whether it
 * did, so the caller can show its "press again" message when it did not.
 */
export function reloadForNewBuild(
  win: Pick<Window, 'location' | 'sessionStorage'> | undefined = typeof window === 'undefined'
    ? undefined
    : window,
  now: number = Date.now(),
): boolean {
  if (!win) return false;
  try {
    const last = Number(win.sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Number.isFinite(last) && now - last < RELOAD_GUARD_MS) return false;
    win.sessionStorage.setItem(RELOADED_AT, String(now));
  } catch {
    // Storage off (private mode): reload anyway; the new build has the ids.
  }
  win.location.reload();
  return true;
}

/**
 * A script or stylesheet of the running build that is no longer there
 * (go-live audit M4).
 *
 * The service worker takes over as soon as a new one is installed
 * (`skipWaiting` + `clientsClaim`, sw.ts) and drops the previous build's
 * precache. A tab that was open before the deploy still runs the old build,
 * so the next screen it opens asks for chunks the server no longer has.
 * webpack rejects with a `ChunkLoadError`, and the screen falls to the error
 * boundary. A browser's own `import()` fails with its own wording, matched
 * here as well. The cure is the same reload as a stale server action.
 */
const CHUNK_FAILURE =
  /Loading (?:CSS )?chunk [\w./-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isStaleChunk(error: unknown): boolean {
  if (typeof error === 'string') return CHUNK_FAILURE.test(error);
  if (!error || typeof error !== 'object') return false;
  const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown };
  if (name === 'ChunkLoadError' || code === 'CSS_CHUNK_LOAD_FAILED') return true;
  return typeof message === 'string' && CHUNK_FAILURE.test(message);
}

type ReloadWindow = Pick<Window, 'location' | 'sessionStorage'> & {
  navigator?: Pick<Navigator, 'onLine'>;
};

/**
 * Reload onto the current build when `error` is a missing chunk, at most
 * once a minute (`reloadForNewBuild`'s guard, shared with stale server
 * actions, so the two cannot reload in turn). Not while the phone is
 * offline: then the chunk is missing because there is no network, not
 * because the build moved on, and a reload would only swap the screen for
 * /offline. Answers whether it reloaded.
 */
export function reloadForStaleChunk(
  error: unknown,
  win: ReloadWindow | undefined = typeof window === 'undefined' ? undefined : window,
  now: number = Date.now(),
): boolean {
  if (!win || !isStaleChunk(error)) return false;
  if (win.navigator?.onLine === false) return false;
  return reloadForNewBuild(win, now);
}

/**
 * Listen for missing chunks that no error boundary catches: a rejected
 * `import()` nobody awaited, or an error thrown outside React. The error
 * boundary (app/error.tsx) handles the ones a screen throws. Returns the
 * cleanup.
 */
export function watchForStaleChunks(
  win: ReloadWindow & Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const onError = (event: Event) => {
    const e = event as ErrorEvent;
    reloadForStaleChunk(e.error ?? e.message, win);
  };
  const onRejection = (event: Event) => {
    reloadForStaleChunk((event as PromiseRejectionEvent).reason, win);
  };
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  return () => {
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onRejection);
  };
}
