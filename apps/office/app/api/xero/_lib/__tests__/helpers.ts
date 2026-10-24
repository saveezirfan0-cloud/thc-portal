import type { TokenStore, XeroConnection, XeroTokens } from '../client';

/** An in-memory xero_connection with the same lock and compare-and-swap rules as the database. */
export function memoryStore(initial: Partial<XeroConnection> = {}) {
  let conn: XeroConnection | null = {
    tenantId: 'tenant-1',
    tenantName: 'THC Ltd',
    accessToken: 'access-0',
    refreshToken: 'refresh-0',
    expiresAt: new Date('2026-10-26T10:30:00Z'),
    scopes: 'offline_access',
    ...initial,
  };
  let locked = false;
  const log: string[] = [];
  const store: TokenStore = {
    async load() {
      return conn ? { ...conn } : null;
    },
    async tryLock() {
      if (locked) return false;
      locked = true;
      log.push('lock');
      return true;
    },
    async unlock() {
      locked = false;
      log.push('unlock');
    },
    async save(previous: string, tokens: XeroTokens) {
      if (!conn || conn.refreshToken !== previous) return false;
      conn = { ...conn, ...tokens };
      log.push(`save:${tokens.refreshToken}`);
      return true;
    },
  };
  return { store, log, get: () => conn, disconnect: () => (conn = null) };
}

export type Call = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
};

/** A scripted Xero: handlers are tried in order; the first that returns a Response wins. */
export function scriptedFetch(
  handlers: ((call: Call) => Response | undefined | Promise<Response | undefined>)[],
) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers,
      body: typeof init?.body === 'string' ? init.body : init?.body ? '[binary]' : undefined,
    };
    calls.push(call);
    for (const h of handlers) {
      const out = await h(call);
      if (out) return out;
    }
    return json(500, { Message: `unscripted ${call.method} ${call.url}` });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export const tokenOk = (n: number) =>
  json(200, {
    access_token: `access-${n}`,
    refresh_token: `refresh-${n}`,
    expires_in: 1800,
    scope: 'offline_access accounting.invoices',
  });

export const NOW = new Date('2026-10-26T10:00:00Z');
