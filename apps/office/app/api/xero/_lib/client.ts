import { createHash } from 'node:crypto';
import { XERO_API_URL, XERO_CONNECTIONS_URL, XERO_REVOKE_URL, XERO_TOKEN_URL } from './config';
import type { XeroEnv } from './config';

/**
 * A minimal Xero client (ADR-0211): OAuth token handling under a lock, the
 * handful of Accounting calls the invoice push needs, and 429 / 5xx backoff.
 *
 * `fetch`, the clock and the sleep are injected so the tests run the whole
 * thing against a scripted Xero. No token, header or request body is ever
 * logged or put in an error message; an error carries Xero's own validation
 * text (about configuration: account codes, contacts) and a status.
 */

export interface XeroTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes?: string | null;
}

export interface XeroConnection extends XeroTokens {
  tenantId: string;
  tenantName: string | null;
}

/** Where the one connection lives (xero_connection, service role). */
export interface TokenStore {
  load(): Promise<XeroConnection | null>;
  /** Atomic: true only for the one caller that now holds the refresh lock. */
  tryLock(seconds: number): Promise<boolean>;
  unlock(): Promise<void>;
  /** Compare-and-swap on the refresh token that was used; false if it moved. */
  save(previousRefreshToken: string, tokens: XeroTokens): Promise<boolean>;
}

export type XeroErrorKind =
  | 'not_connected'
  | 'auth'
  | 'forbidden'
  | 'rate_limit'
  | 'validation'
  | 'not_found'
  | 'server'
  | 'network';

export class XeroError extends Error {
  constructor(
    readonly kind: XeroErrorKind,
    message: string,
    readonly status?: number,
    /** Seconds Xero asked us to wait (rate limit). */
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'XeroError';
  }
}

export interface XeroClientOptions {
  env: Pick<XeroEnv, 'clientId' | 'clientSecret'>;
  store: TokenStore;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Attempts per call, first included. */
  maxAttempts?: number;
  /** A Retry-After longer than this is not waited out: the caller is told. */
  maxWaitMs?: number;
}

export interface XeroInvoiceResult {
  InvoiceID: string;
  InvoiceNumber?: string;
  Status?: string;
  Total?: number;
  Attachments?: { FileName?: string }[];
}

export interface XeroLineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;
  TaxType: string;
  LineAmount: number;
  TaxAmount?: number;
}

export interface XeroInvoicePayload {
  Type: 'ACCREC';
  Contact: { ContactID: string };
  InvoiceNumber: string;
  Reference?: string;
  Date: string;
  DueDate: string;
  CurrencyCode: 'GBP';
  LineAmountTypes: 'Exclusive';
  Status: string;
  LineItems: XeroLineItem[];
}

const REFRESH_SKEW_MS = 60_000;
const LOCK_SECONDS = 30;
const LOCK_WAIT_STEPS = 12;

const sleepReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class XeroClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly maxWaitMs: number;
  /** Within one process, concurrent callers share one refresh. */
  private inflight: Promise<XeroConnection> | null = null;

  constructor(private readonly opts: XeroClientOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? sleepReal;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.maxWaitMs = opts.maxWaitMs ?? 60_000;
  }

  // ---- OAuth -----------------------------------------------------------

  private basic(): string {
    const { clientId, clientSecret } = this.opts.env;
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  private async tokenCall(form: Record<string, string>): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scopes: string | null;
  }> {
    let res: Response;
    try {
      res = await this.fetchFn(XERO_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: this.basic(),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(form).toString(),
      });
    } catch {
      throw new XeroError('network', 'Could not reach Xero to sign in.');
    }
    const body = (await readJson(res)) as Record<string, unknown> | null;
    if (!res.ok) {
      // invalid_grant = the refresh token is spent or the app was disconnected.
      const code = typeof body?.['error'] === 'string' ? body['error'] : `HTTP ${res.status}`;
      throw new XeroError(
        res.status >= 500 ? 'server' : 'auth',
        `Xero refused the sign-in (${code}).`,
        res.status,
      );
    }
    const access = body?.['access_token'];
    const refresh = body?.['refresh_token'];
    const expires = Number(body?.['expires_in']);
    if (typeof access !== 'string' || typeof refresh !== 'string' || !Number.isFinite(expires)) {
      throw new XeroError('auth', 'Xero answered the sign-in without a token.', res.status);
    }
    return {
      accessToken: access,
      refreshToken: refresh,
      expiresAt: new Date(this.now().getTime() + expires * 1000),
      scopes: typeof body?.['scope'] === 'string' ? body['scope'] : null,
    };
  }

  /** The authorisation-code exchange (connect callback). */
  exchangeCode(code: string, redirectUri: string) {
    return this.tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }

  /** The organisations the token was granted. The first ORGANISATION is the one used. */
  async listConnections(accessToken: string): Promise<{ tenantId: string; tenantName: string }[]> {
    let res: Response;
    try {
      res = await this.fetchFn(XERO_CONNECTIONS_URL, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
    } catch {
      throw new XeroError('network', 'Could not reach Xero.');
    }
    if (!res.ok)
      throw new XeroError(
        'auth',
        `Xero would not list the organisations (HTTP ${res.status}).`,
        res.status,
      );
    const rows = (await readJson(res)) as
      { tenantId?: string; tenantName?: string; tenantType?: string }[] | null;
    return (Array.isArray(rows) ? rows : [])
      .filter(
        (r) =>
          typeof r.tenantId === 'string' && (r.tenantType ?? 'ORGANISATION') === 'ORGANISATION',
      )
      .map((r) => ({ tenantId: r.tenantId as string, tenantName: r.tenantName ?? '' }));
  }

  /** Best effort: the refresh token stops working at Xero. */
  async revoke(refreshToken: string): Promise<void> {
    try {
      await this.fetchFn(XERO_REVOKE_URL, {
        method: 'POST',
        headers: {
          Authorization: this.basic(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
    } catch {
      /* the local disconnect goes ahead regardless */
    }
  }

  private fresh(conn: XeroConnection): boolean {
    return conn.expiresAt.getTime() - this.now().getTime() > REFRESH_SKEW_MS;
  }

  /**
   * A usable connection. Refresh tokens ROTATE: the new pair is saved before
   * the new access token is used, and the refresh runs under the database
   * lock so two workers (the 15-minute job and "Sync now") never spend the
   * same refresh token. `rejected` is an access token Xero just refused with
   * 401: if the stored one differs, someone has already refreshed.
   */
  private async connection(rejected?: string): Promise<XeroConnection> {
    const conn = await this.opts.store.load();
    if (!conn) throw new XeroError('not_connected', 'Xero is not connected.');
    if (this.fresh(conn) && conn.accessToken !== rejected) return conn;
    if (!this.inflight) {
      this.inflight = this.refreshLocked(rejected).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Refresh now if the stored access token is stale (used by the keep-alive). */
  async ensureFresh(): Promise<void> {
    await this.connection();
  }

  private async refreshLocked(rejected?: string): Promise<XeroConnection> {
    const { store } = this.opts;
    let held = false;
    for (let i = 0; i < LOCK_WAIT_STEPS && !held; i += 1) {
      held = await store.tryLock(LOCK_SECONDS);
      if (held) break;
      // Another process is refreshing; wait, then take its result if it is good.
      await this.sleep(1000);
      const seen = await store.load();
      if (!seen) throw new XeroError('not_connected', 'Xero is not connected.');
      if (this.fresh(seen) && seen.accessToken !== rejected) return seen;
    }
    if (!held) throw new XeroError('auth', 'Another Xero refresh did not finish; will retry.');
    try {
      const current = await store.load();
      if (!current) throw new XeroError('not_connected', 'Xero is not connected.');
      // Someone refreshed between our read and the lock.
      if (this.fresh(current) && current.accessToken !== rejected) return current;

      const next = await this.tokenCall({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      });
      // Persist the rotated pair BEFORE the new access token is used. A failed
      // save is retried: the old refresh token is already spent at Xero.
      let saved = false;
      for (let i = 0; i < 3 && !saved; i += 1) {
        try {
          saved = await store.save(current.refreshToken, next);
          if (!saved) break; // the row moved under the lock; do not overwrite it
        } catch {
          await this.sleep(250 * (i + 1));
        }
      }
      if (!saved) {
        const again = await store.load();
        if (again && this.fresh(again)) return again;
        throw new XeroError(
          'auth',
          'Xero refreshed the sign-in but it could not be stored; reconnect Xero.',
        );
      }
      return { ...current, ...next };
    } finally {
      await store.unlock().catch(() => undefined);
    }
  }

  // ---- Accounting API --------------------------------------------------

  private async request(
    method: 'GET' | 'PUT' | 'POST',
    path: string,
    init: {
      query?: Record<string, string>;
      json?: unknown;
      body?: Uint8Array;
      contentType?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; body: unknown }> {
    const url = new URL(`${XERO_API_URL}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

    let refreshedOn401 = false;
    let rejected: string | undefined;
    let lastKind: XeroError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const conn = await this.connection(rejected);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${conn.accessToken}`,
        'xero-tenant-id': conn.tenantId,
        Accept: 'application/json',
        ...init.headers,
      };
      let body: BodyInit | undefined;
      if (init.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(init.json);
      } else if (init.body) {
        headers['Content-Type'] = init.contentType ?? 'application/octet-stream';
        headers['Content-Length'] = String(init.body.byteLength);
        body = init.body as unknown as BodyInit;
      }

      let res: Response;
      try {
        res = await this.fetchFn(url.toString(), { method, headers, body });
      } catch {
        lastKind = new XeroError('network', 'Could not reach Xero.');
        await this.sleep(backoffMs(attempt));
        continue;
      }

      if (res.status === 401) {
        if (refreshedOn401)
          throw new XeroError('auth', 'Xero refused the sign-in; reconnect Xero.', 401);
        refreshedOn401 = true;
        rejected = conn.accessToken;
        continue;
      }
      if (res.status === 429) {
        const header = Number(res.headers.get('retry-after'));
        const waitSec = Number.isFinite(header) && header > 0 ? header : 2 ** attempt * 5;
        const problem = res.headers.get('x-rate-limit-problem') ?? 'minute';
        lastKind = new XeroError(
          'rate_limit',
          `Xero rate limit (${problem}); retry in ${Math.ceil(waitSec)} s.`,
          429,
          waitSec,
        );
        if (waitSec * 1000 > this.maxWaitMs) throw lastKind;
        await this.sleep(waitSec * 1000);
        continue;
      }
      if (res.status >= 500) {
        lastKind = new XeroError('server', `Xero error (HTTP ${res.status}).`, res.status);
        await this.sleep(backoffMs(attempt));
        continue;
      }
      const parsed = await readJson(res);
      if (res.status === 403) {
        throw new XeroError(
          'forbidden',
          'Xero refused: this connection lacks permission (check the scopes and reconnect).',
          403,
        );
      }
      if (res.status === 404) throw new XeroError('not_found', 'Not found in Xero.', 404);
      if (res.status >= 400) {
        throw new XeroError(
          'validation',
          xeroMessage(parsed) || `Xero refused the request (HTTP ${res.status}).`,
          res.status,
        );
      }
      return { status: res.status, body: parsed };
    }
    throw lastKind ?? new XeroError('server', 'Xero did not answer.');
  }

  /** The Xero contact whose name matches (case-insensitive), or null. */
  async findContact(name: string): Promise<string | null> {
    // searchTerm rather than a where filter: no quote-escaping of a client name.
    const { body } = await this.request('GET', '/Contacts', {
      query: { searchTerm: name, pageSize: '100' },
    });
    const wanted = name.trim().toLowerCase();
    const hit = (
      (body as { Contacts?: { ContactID: string; Name?: string }[] })?.Contacts ?? []
    ).find((c) => (c.Name ?? '').trim().toLowerCase() === wanted);
    return hit?.ContactID ?? null;
  }

  async createContact(name: string, email?: string | null): Promise<string> {
    const key = `thc-contact-${createHash('sha1').update(name.trim().toLowerCase()).digest('hex').slice(0, 24)}`;
    const { body } = await this.request('PUT', '/Contacts', {
      json: { Contacts: [{ Name: name, ...(email ? { EmailAddress: email } : {}) }] },
      headers: { 'Idempotency-Key': key },
    });
    const id = (body as { Contacts?: { ContactID?: string }[] })?.Contacts?.[0]?.ContactID;
    if (!id) throw new XeroError('validation', 'Xero created no contact.');
    return id;
  }

  async invoiceByNumber(number: string): Promise<XeroInvoiceResult | null> {
    const { body } = await this.request('GET', '/Invoices', { query: { InvoiceNumbers: number } });
    const list = (body as { Invoices?: XeroInvoiceResult[] })?.Invoices ?? [];
    return list.find((i) => i.InvoiceNumber === number) ?? list[0] ?? null;
  }

  async invoiceById(id: string): Promise<XeroInvoiceResult | null> {
    try {
      const { body } = await this.request('GET', `/Invoices/${encodeURIComponent(id)}`);
      return (body as { Invoices?: XeroInvoiceResult[] })?.Invoices?.[0] ?? null;
    } catch (e) {
      if (e instanceof XeroError && e.kind === 'not_found') return null;
      throw e;
    }
  }

  /** PUT creates only: it can never overwrite an existing invoice. */
  async createInvoice(
    payload: XeroInvoicePayload,
    idempotencyKey: string,
  ): Promise<XeroInvoiceResult> {
    const { body } = await this.request('PUT', '/Invoices', {
      json: { Invoices: [payload] },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    const made = (body as { Invoices?: XeroInvoiceResult[] })?.Invoices?.[0];
    if (!made?.InvoiceID) throw new XeroError('validation', 'Xero created no invoice.');
    return made;
  }

  async attachmentNames(invoiceId: string): Promise<string[]> {
    const { body } = await this.request(
      'GET',
      `/Invoices/${encodeURIComponent(invoiceId)}/Attachments`,
    );
    return ((body as { Attachments?: { FileName?: string }[] })?.Attachments ?? [])
      .map((a) => a.FileName ?? '')
      .filter(Boolean);
  }

  async attachPdf(invoiceId: string, fileName: string, pdf: Uint8Array): Promise<void> {
    await this.request(
      'PUT',
      `/Invoices/${encodeURIComponent(invoiceId)}/Attachments/${encodeURIComponent(fileName)}`,
      { body: pdf, contentType: 'application/pdf' },
    );
  }
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 15_000);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Xero's validation text (about accounts, contacts, numbers), never the request. */
export function xeroMessage(body: unknown): string {
  const b = (body ?? {}) as {
    Message?: string;
    Detail?: string;
    Title?: string;
    Elements?: { ValidationErrors?: { Message?: string }[] }[];
  };
  const texts = (b.Elements ?? []).flatMap((e) =>
    (e.ValidationErrors ?? []).map((v) => v.Message ?? ''),
  );
  const unique = [...new Set(texts.filter(Boolean))];
  return (unique.length > 0 ? unique.join(' ') : (b.Detail ?? b.Message ?? b.Title ?? '')).slice(
    0,
    250,
  );
}
