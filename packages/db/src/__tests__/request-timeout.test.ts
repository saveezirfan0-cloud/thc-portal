import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_READ_TIMEOUT_MS,
  RequestTimeoutError,
  SESSION_CHECK_TIMEOUT_MS,
  createRequestTimeoutFetch,
  isRequestTimeoutError,
  isTransientAuthFailure,
  requestTimeoutFor,
} from '../request-timeout';

/**
 * ADR-0154: reads to PostgREST / GoTrue are bounded; writes and RPCs over
 * POST are not unless the caller names the RPC as read-only.
 */
const BASE = 'https://abcdefghij.supabase.co';

describe('requestTimeoutFor — the policy', () => {
  it('bounds PostgREST and GoTrue reads at 10 s by default', () => {
    expect(requestTimeoutFor('GET', `${BASE}/rest/v1/staff?select=id`)).toBe(
      DEFAULT_READ_TIMEOUT_MS,
    );
    expect(requestTimeoutFor('HEAD', `${BASE}/rest/v1/staff?select=*`)).toBe(10_000);
    expect(requestTimeoutFor('get', `${BASE}/auth/v1/settings`)).toBe(10_000);
    expect(requestTimeoutFor('GET', `${BASE}/rest/v1/rpc/staff_open_shifts?p=1`)).toBe(10_000);
  });

  it('never bounds a write: insert, update, delete, upsert, sign-in, token refresh', () => {
    expect(requestTimeoutFor('POST', `${BASE}/rest/v1/bookings`)).toBeNull();
    expect(requestTimeoutFor('PATCH', `${BASE}/rest/v1/bookings?id=eq.1`)).toBeNull();
    expect(requestTimeoutFor('DELETE', `${BASE}/rest/v1/bookings?id=eq.1`)).toBeNull();
    expect(requestTimeoutFor('PUT', `${BASE}/auth/v1/user`)).toBeNull();
    expect(requestTimeoutFor('POST', `${BASE}/auth/v1/token?grant_type=refresh_token`)).toBeNull();
  });

  it('never bounds an RPC over POST unless the caller lists it as read-only', () => {
    const url = `${BASE}/rest/v1/rpc/accept_invite`;
    expect(requestTimeoutFor('POST', url)).toBeNull();
    expect(requestTimeoutFor('POST', url, { readOnlyRpcs: ['staff_open_shifts'] })).toBeNull();
    expect(
      requestTimeoutFor('POST', `${BASE}/rest/v1/rpc/staff_open_shifts`, {
        readOnlyRpcs: ['staff_open_shifts'],
      }),
    ).toBe(10_000);
    expect(
      requestTimeoutFor('POST', `${BASE}/rest/v1/rpc/auto_assign_candidates`, {
        readMs: 7_000,
        readOnlyRpcs: ['auto_assign_candidates'],
      }),
    ).toBe(7_000);
  });

  it('leaves Storage and Functions alone, reads included', () => {
    expect(requestTimeoutFor('GET', `${BASE}/storage/v1/object/documents/a/b.pdf`)).toBeNull();
    expect(requestTimeoutFor('GET', `${BASE}/functions/v1/notify-drain`)).toBeNull();
    expect(requestTimeoutFor('POST', `${BASE}/functions/v1/notify-drain`)).toBeNull();
  });

  it('gives auth.getUser() its own limit when asked, and the read limit otherwise', () => {
    expect(requestTimeoutFor('GET', `${BASE}/auth/v1/user`)).toBe(10_000);
    expect(
      requestTimeoutFor('GET', `${BASE}/auth/v1/user`, { getUserMs: SESSION_CHECK_TIMEOUT_MS }),
    ).toBe(4_000);
    expect(requestTimeoutFor('GET', `${BASE}/rest/v1/staff`, { getUserMs: 4_000 })).toBe(10_000);
    // Reads switched off still lets the session check be bounded.
    expect(requestTimeoutFor('GET', `${BASE}/rest/v1/staff`, { readMs: 0 })).toBeNull();
    expect(requestTimeoutFor('GET', `${BASE}/auth/v1/user`, { readMs: 0, getUserMs: 4_000 })).toBe(
      4_000,
    );
  });

  it('does not guess about a URL it cannot parse', () => {
    expect(requestTimeoutFor('GET', 'not a url')).toBeNull();
  });
});

/** A fetch that answers only when told, or rejects with its signal's reason. */
function hangingFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), init });
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // never settles: an unbounded request
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  return { fn: fn as unknown as typeof fetch, calls, spy: fn };
}

describe('createRequestTimeoutFetch', () => {
  it('aborts a read after its limit with a RequestTimeoutError named AbortError', async () => {
    const { fn } = hangingFetch();
    const timed = createRequestTimeoutFetch({ readMs: 20, fetch: fn });
    const error = await timed(`${BASE}/rest/v1/staff?select=id`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect((error as RequestTimeoutError).name).toBe('AbortError');
    expect((error as RequestTimeoutError).message).toBe(
      'Supabase GET /rest/v1/staff timed out after 20 ms',
    );
    expect(isRequestTimeoutError(error)).toBe(true);
  });

  it('passes a write through with no signal of its own', async () => {
    const answered = new Response('[]', { status: 201 });
    const base = vi.fn(async () => answered);
    const timed = createRequestTimeoutFetch({ readMs: 20, fetch: base as unknown as typeof fetch });
    const body = JSON.stringify({ staff_id: 'x' });
    const init = { method: 'POST', body };
    await expect(timed(`${BASE}/rest/v1/bookings`, init)).resolves.toBe(answered);
    expect(base).toHaveBeenCalledWith(`${BASE}/rest/v1/bookings`, init);
  });

  it('bounds an RPC over POST only when it is listed', async () => {
    const { fn, calls } = hangingFetch();
    const timed = createRequestTimeoutFetch({
      readMs: 20,
      readOnlyRpcs: ['reads_only'],
      fetch: fn,
    });
    await expect(
      timed(`${BASE}/rest/v1/rpc/reads_only`, { method: 'POST' }),
    ).rejects.toBeInstanceOf(RequestTimeoutError);
    void timed(`${BASE}/rest/v1/rpc/writes_too`, { method: 'POST' });
    expect(calls[1]?.init?.signal).toBeUndefined();
  });

  it('keeps the caller’s own abort as the caller’s error', async () => {
    const { fn } = hangingFetch();
    const timed = createRequestTimeoutFetch({ readMs: 5_000, fetch: fn });
    const controller = new AbortController();
    const pending = timed(`${BASE}/rest/v1/staff`, { signal: controller.signal });
    const reason = new Error('navigated away');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('reads the method and URL from a Request object', async () => {
    const { fn, calls } = hangingFetch();
    const timed = createRequestTimeoutFetch({ readMs: 20, fetch: fn });
    await expect(timed(new Request(`${BASE}/rest/v1/staff`))).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
    const write = new Request(`${BASE}/rest/v1/staff`, { method: 'POST', body: '{}' });
    void timed(write);
    expect(calls[1]?.init).toBeUndefined();
  });

  it('looks up globalThis.fetch per call when no fetch is given', async () => {
    const answered = new Response('ok');
    const stub = vi.fn(async () => answered);
    vi.stubGlobal('fetch', stub);
    try {
      const timed = createRequestTimeoutFetch();
      await expect(timed(`${BASE}/rest/v1/staff`)).resolves.toBe(answered);
      expect(stub).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('through supabase-js', () => {
  it('a timed-out read comes back as { error } once — postgrest-js does not retry it', async () => {
    const { fn, spy } = hangingFetch();
    const db = createClient(BASE, 'anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: createRequestTimeoutFetch({ readMs: 25, fetch: fn }) },
    });
    const { data, error, status } = await db.from('staff').select('id');
    expect(data).toBeNull();
    expect(status).toBe(0);
    expect(error?.message).toMatch(/timed out after 25 ms/);
    expect(isRequestTimeoutError(error)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('auth.getUser() gives up at its own limit, as a transient failure, not "signed out"', async () => {
    const { fn } = hangingFetch();
    const db = createClient(BASE, 'anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: createRequestTimeoutFetch({ readMs: 5_000, getUserMs: 25, fetch: fn }) },
    });
    const started = Date.now();
    const { data, error } = await db.auth.getUser('header.payload.signature');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(data.user).toBeNull();
    expect(error).not.toBeNull();
    expect(isTransientAuthFailure(error)).toBe(true);
  });
});

describe('isTransientAuthFailure', () => {
  it('is true for network, timeout, 5xx and 429; false for an answer about the session', () => {
    expect(isTransientAuthFailure({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
    expect(isTransientAuthFailure({ name: 'AuthApiError', status: 503 })).toBe(true);
    expect(isTransientAuthFailure({ name: 'AuthApiError', status: 429 })).toBe(true);
    expect(isTransientAuthFailure(new RequestTimeoutError(4_000, 'GET', '/auth/v1/user'))).toBe(
      true,
    );
    expect(isTransientAuthFailure({ name: 'AuthApiError', status: 401 })).toBe(false);
    expect(isTransientAuthFailure({ name: 'AuthApiError', status: 403 })).toBe(false);
    expect(isTransientAuthFailure({ name: 'AuthSessionMissingError', status: 400 })).toBe(false);
    expect(isTransientAuthFailure(null)).toBe(false);
  });
});

describe('isRequestTimeoutError', () => {
  it('recognises the shapes a timeout arrives in, and nothing else', () => {
    expect(
      isRequestTimeoutError({
        message: 'AbortError: Supabase GET /rest/v1/x timed out after 10000 ms',
      }),
    ).toBe(true);
    expect(
      isRequestTimeoutError({
        name: 'TimeoutError',
        message: 'The operation was aborted due to timeout',
      }),
    ).toBe(true);
    expect(
      isRequestTimeoutError({ message: 'TimeoutError: The operation was aborted due to timeout' }),
    ).toBe(true);
    expect(isRequestTimeoutError({ message: 'AbortError: The user aborted a request.' })).toBe(
      false,
    );
    expect(
      isRequestTimeoutError({ message: 'permission denied for table staff', code: '42501' }),
    ).toBe(false);
    expect(isRequestTimeoutError(undefined)).toBe(false);
  });
});
