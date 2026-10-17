/**
 * Request timeouts for the server-side Supabase clients (ADR-0152).
 *
 * Without one, a PostgREST or GoTrue call that stalls — the live project on
 * 17.10.2026 queued requests behind an exhausted connection pool — holds the
 * Vercel function until the platform kills it, and in middleware that is
 * the whole page (504 MIDDLEWARE_INVOCATION_TIMEOUT). A bounded wait turns
 * that into an ordinary `{ error }` the caller already handles.
 *
 * What is aborted, and what never is:
 *
 *  - READS: GET and HEAD to PostgREST (`/rest/v1/`) and GoTrue (`/auth/v1/`),
 *    after `readMs` (10 s). A read has no side effect, so giving up on one
 *    loses nothing.
 *  - `auth.getUser()` (GET `/auth/v1/user`) after `getUserMs` when given — the
 *    middleware's session check wants a shorter limit than a page's data.
 *  - RPCs over POST (`/rest/v1/rpc/<name>`) ONLY when the caller lists the
 *    function in `readOnlyRpcs`. PostgREST cannot tell us whether a function
 *    writes, and a write aborted mid-flight has an unknown outcome: it may
 *    commit after we stopped listening. So the caller who knows opts in.
 *  - Never: any other POST, PATCH, PUT or DELETE (inserts, updates, token
 *    refresh, sign-in), Storage (`/storage/v1/` — a download may be large and
 *    legitimately slow) and Functions (`/functions/v1/`).
 *
 * A caller's own `abortSignal()` keeps working; whichever fires first wins.
 *
 * A timed-out request rejects with a `RequestTimeoutError` whose `name` is
 * `AbortError`, deliberately: postgrest-js retries a GET whose fetch rejects
 * (three times, with backoff) unless the rejection is an abort, and retrying
 * a request that just waited ten seconds on an overloaded database only adds
 * to the load. postgrest-js then returns its usual
 * `{ error: { message: 'AbortError: Supabase GET … timed out after 10000 ms' }, status: 0 }`.
 *
 * Edge-runtime safe (the apps' middleware imports it): no Node APIs.
 */

/** A page's or job's PostgREST / GoTrue read. */
export const DEFAULT_READ_TIMEOUT_MS = 10_000;

/** The middleware's GoTrue session check (`auth.getUser()`), ADR-0108. */
export const SESSION_CHECK_TIMEOUT_MS = 4_000;

export interface RequestTimeoutOptions {
  /**
   * GET/HEAD to PostgREST and GoTrue. Default `DEFAULT_READ_TIMEOUT_MS`.
   * `0` (or less) leaves reads unbounded.
   */
  readMs?: number;
  /**
   * GoTrue's `GET /auth/v1/user`, which `auth.getUser()` calls. Default:
   * `readMs`. The office middleware passes `SESSION_CHECK_TIMEOUT_MS`.
   */
  getUserMs?: number;
  /**
   * RPCs that only read, by function name, aborted after `readMs` even
   * though PostgREST is called with POST. Opt-in per function: a listed
   * function that writes would leave its outcome unknown when aborted.
   * Calling an RPC with `{ get: true }` (or `head: true`) makes it a GET,
   * which is covered without listing it.
   */
  readOnlyRpcs?: readonly string[];
  /** The fetch to wrap. Default: `globalThis.fetch`, looked up per call. */
  fetch?: typeof fetch;
}

/** Thrown in place of the platform's TimeoutError; see the module comment. */
export class RequestTimeoutError extends Error {
  override readonly name = 'AbortError';
  readonly code = 'THC_REQUEST_TIMEOUT';
  constructor(
    readonly timeoutMs: number,
    readonly method: string,
    readonly path: string,
  ) {
    super(`Supabase ${method} ${path} timed out after ${timeoutMs} ms`);
  }
}

const READ_METHODS = new Set(['GET', 'HEAD']);
const REST = /(?:^|\/)rest\/v1\//;
const AUTH = /(?:^|\/)auth\/v1\//;
const AUTH_USER = /(?:^|\/)auth\/v1\/user\/?$/;
const RPC = /(?:^|\/)rest\/v1\/rpc\/([^/]+)\/?$/;

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * How long this request may take, in ms, or `null` for "never abort it".
 * Pure, so the policy is testable without a network.
 */
export function requestTimeoutFor(
  method: string,
  url: string,
  options: RequestTimeoutOptions = {},
): number | null {
  const path = pathOf(url);
  if (path === null) return null;
  const verb = method.toUpperCase();
  const readMs = options.readMs ?? DEFAULT_READ_TIMEOUT_MS;
  const positive = (ms: number | undefined) => (ms !== undefined && ms > 0 ? ms : null);

  if (verb === 'GET' && AUTH_USER.test(path)) return positive(options.getUserMs ?? readMs);
  if (READ_METHODS.has(verb) && (REST.test(path) || AUTH.test(path))) return positive(readMs);

  if (verb === 'POST') {
    const rpc = RPC.exec(path);
    const name = rpc?.[1] === undefined ? null : safeDecode(rpc[1]);
    if (name !== null && options.readOnlyRpcs?.includes(name)) return positive(readMs);
  }
  return null;
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Either signal aborting aborts the result (AbortSignal.any where it exists). */
function eitherSignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const any = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === 'function') return any.call(AbortSignal, [a, b]);
  const controller = new AbortController();
  for (const signal of [a, b]) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function describe(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
  const url = request ? request.url : input instanceof URL ? input.href : String(input);
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  return { method, url };
}

/**
 * A `fetch` for `createClient(url, key, { global: { fetch } })` that applies
 * the policy above. Requests it does not time out pass through untouched.
 */
export function createRequestTimeoutFetch(options: RequestTimeoutOptions = {}): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const base = options.fetch ?? globalThis.fetch;
    const { method, url } = describe(input, init);
    const ms = requestTimeoutFor(method, url, options);
    if (ms === null) return base(input, init);

    const timer = AbortSignal.timeout(ms);
    const callerSignal =
      init?.signal ??
      (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    const signal = callerSignal ? eitherSignal(callerSignal, timer) : timer;
    try {
      return await base(input, { ...init, signal });
    } catch (error) {
      // The caller's own abort stays the caller's error.
      if (timer.aborted && !callerSignal?.aborted) {
        throw new RequestTimeoutError(ms, method, pathOf(url) ?? url);
      }
      throw error;
    }
  };
}

/**
 * Did this Supabase error come from a request timeout? Accepts what
 * postgrest-js returns (`{ message: 'AbortError: … timed out after …' }`),
 * what auth-js returns (`AuthRetryableFetchError` carrying that message), a
 * `RequestTimeoutError` itself, and the platform's TimeoutError (a body read
 * that outlived the limit after the headers arrived).
 */
export function isRequestTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  if (e.code === 'THC_REQUEST_TIMEOUT' || e.name === 'TimeoutError') return true;
  return typeof e.message === 'string' && /timed out after \d+ ms|TimeoutError/.test(e.message);
}

/**
 * Is a GoTrue failure transient — the service slow, down or rate-limiting —
 * rather than an answer about the session? A caller deciding "signed out"
 * must not decide it on one of these (go-live audit L1): auth-js reports a
 * network failure or timeout as `AuthRetryableFetchError` with status 0, and
 * a 5xx or 429 as the same class with that status.
 */
export function isTransientAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; status?: unknown };
  if (e.name === 'AuthRetryableFetchError') return true;
  if (isRequestTimeoutError(error)) return true;
  const status = typeof e.status === 'number' ? e.status : null;
  return status === 0 || status === 429 || (status !== null && status >= 500);
}
