import { describe, expect, it } from 'vitest';
import { XeroClient, XeroError } from '../client';
import { NOW, json, memoryStore, scriptedFetch, tokenOk } from './helpers';

const env = { clientId: 'cid', clientSecret: 'secret' };
const isToken = (c: { url: string }) => c.url.includes('identity.xero.com/connect/token');
const noSleep = () => Promise.resolve();

function client(
  store: ReturnType<typeof memoryStore>['store'],
  fetchFn: typeof fetch,
  extra: { sleep?: (ms: number) => Promise<void> } = {},
) {
  return new XeroClient({
    env,
    store,
    fetch: fetchFn,
    now: () => NOW,
    sleep: extra.sleep ?? noSleep,
  });
}

describe('token refresh', () => {
  it('uses a fresh access token without refreshing', async () => {
    const m = memoryStore();
    const x = scriptedFetch([
      (c) => (c.url.includes('/Contacts') ? json(200, { Contacts: [] }) : undefined),
    ]);
    await client(m.store, x.fn).findContact('Acme');
    expect(x.calls.filter(isToken)).toHaveLength(0);
    expect(x.calls[0]!.headers['authorization']).toBe('Bearer access-0');
    expect(x.calls[0]!.headers['xero-tenant-id']).toBe('tenant-1');
  });

  it('refreshes a stale token, persisting the rotated pair BEFORE using it', async () => {
    const m = memoryStore({ expiresAt: new Date(NOW.getTime() - 1000) });
    const order: string[] = [];
    const x = scriptedFetch([
      (c) => {
        if (isToken(c)) {
          order.push('token');
          return tokenOk(1);
        }
        order.push(`api:${c.headers['authorization']}`);
        return json(200, { Contacts: [] });
      },
    ]);
    const orig = m.store.save;
    m.store.save = async (...a) => {
      order.push('saved');
      return orig(...a);
    };
    await client(m.store, x.fn).findContact('Acme');
    expect(order).toEqual(['token', 'saved', 'api:Bearer access-1']);
    expect(m.get()!.refreshToken).toBe('refresh-1');
    const body = new URLSearchParams(x.calls[0]!.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-0');
    expect(x.calls[0]!.headers['authorization']).toBe(
      `Basic ${Buffer.from('cid:secret').toString('base64')}`,
    );
    expect(m.log).toEqual(['lock', 'save:refresh-1', 'unlock']);
  });

  it('two concurrent callers spend the refresh token once (in-process and across processes)', async () => {
    const m = memoryStore({ expiresAt: new Date(NOW.getTime() - 1000) });
    let refreshes = 0;
    const x = scriptedFetch([
      async (c) => {
        if (isToken(c)) {
          refreshes += 1;
          await new Promise((r) => setTimeout(r, 5));
          // The second spend of a rotated token is refused, as Xero does.
          return refreshes === 1 ? tokenOk(1) : json(400, { error: 'invalid_grant' });
        }
        return json(200, { Contacts: [] });
      },
    ]);
    // Two separate clients = two processes sharing one database row and lock.
    const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 3)));
    const a = client(m.store, x.fn, { sleep: tick });
    const b = client(m.store, x.fn, { sleep: tick });
    await Promise.all([a.findContact('A'), b.findContact('B'), a.findContact('C')]);
    expect(refreshes).toBe(1);
    expect(m.get()!.refreshToken).toBe('refresh-1');
  });

  it('on invalid_grant reports an auth error and leaves the stored pair alone', async () => {
    const m = memoryStore({ expiresAt: new Date(NOW.getTime() - 1000) });
    const x = scriptedFetch([
      (c) => (isToken(c) ? json(400, { error: 'invalid_grant' }) : undefined),
    ]);
    await expect(client(m.store, x.fn).findContact('A')).rejects.toMatchObject({ kind: 'auth' });
    expect(m.get()!.refreshToken).toBe('refresh-0');
    expect(m.log).toContain('unlock');
  });

  it('a 401 refreshes once and retries the call with the new token', async () => {
    const m = memoryStore();
    const x = scriptedFetch([
      (c) => (isToken(c) ? tokenOk(1) : undefined),
      (c) =>
        c.headers['authorization'] === 'Bearer access-0'
          ? json(401, { Title: 'Unauthorized' })
          : json(200, { Contacts: [{ ContactID: 'c1', Name: 'Acme' }] }),
    ]);
    await expect(client(m.store, x.fn).findContact('Acme')).resolves.toBe('c1');
    expect(x.calls.map((c) => c.headers['authorization'])).toEqual([
      'Bearer access-0',
      `Basic ${Buffer.from('cid:secret').toString('base64')}`,
      'Bearer access-1',
    ]);
  });

  it('a second 401 gives up with an auth error', async () => {
    const m = memoryStore();
    const x = scriptedFetch([(c) => (isToken(c) ? tokenOk(1) : json(401, {}))]);
    await expect(client(m.store, x.fn).findContact('Acme')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('is not connected when there is no row', async () => {
    const m = memoryStore();
    m.disconnect();
    const x = scriptedFetch([]);
    await expect(client(m.store, x.fn).findContact('A')).rejects.toMatchObject({
      kind: 'not_connected',
    });
    expect(x.calls).toHaveLength(0);
  });
});

describe('rate limits and server errors', () => {
  it('waits for Retry-After on 429, then succeeds', async () => {
    const m = memoryStore();
    let n = 0;
    const waits: number[] = [];
    const x = scriptedFetch([
      () =>
        (n += 1) === 1
          ? json(429, {}, { 'retry-after': '7', 'x-rate-limit-problem': 'minute' })
          : json(200, { Contacts: [] }),
    ]);
    await client(m.store, x.fn, { sleep: async (ms) => void waits.push(ms) }).findContact('A');
    expect(waits).toEqual([7000]);
    expect(x.calls).toHaveLength(2);
  });

  it('does not wait out a very long Retry-After (daily limit): it says so', async () => {
    const m = memoryStore();
    const x = scriptedFetch([
      () => json(429, {}, { 'retry-after': '40000', 'x-rate-limit-problem': 'daily' }),
    ]);
    const err = await client(m.store, x.fn)
      .findContact('A')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(XeroError);
    expect(err).toMatchObject({ kind: 'rate_limit', retryAfterSec: 40000 });
    expect(x.calls).toHaveLength(1);
  });

  it('backs off exponentially on 5xx and gives up after the attempts', async () => {
    const m = memoryStore();
    const waits: number[] = [];
    const x = scriptedFetch([() => json(503, {})]);
    await expect(
      client(m.store, x.fn, { sleep: async (ms) => void waits.push(ms) }).findContact('A'),
    ).rejects.toMatchObject({ kind: 'server' });
    expect(waits).toEqual(
      [1000, 2000, 4000, 8000, 16000].slice(0, 5).map((v) => Math.min(v, 15000)),
    );
    expect(x.calls).toHaveLength(5);
  });

  it('a 400 is a validation error carrying Xero text, never the request', async () => {
    const m = memoryStore();
    const x = scriptedFetch([
      () =>
        json(400, {
          Elements: [{ ValidationErrors: [{ Message: 'Account code 999 is not a valid code' }] }],
        }),
    ]);
    const err = (await client(m.store, x.fn)
      .createInvoice({ InvoiceNumber: '1' } as never, 'k')
      .catch((e: unknown) => e)) as XeroError;
    expect(err.kind).toBe('validation');
    expect(err.message).toBe('Account code 999 is not a valid code');
  });
});
