import { describe, expect, it } from 'vitest';
import { XeroClient } from '../client';
import { pushBatch } from '../push';
import type { InvoiceSource, PushDeps } from '../push';
import { runXeroSync } from '../store';
import type { AdminDb } from '../store';
import { DEFAULT_XERO_SETTINGS } from '../settings';
import { auditInvoice } from './fixtures';
import { NOW, json, memoryStore, scriptedFetch, tokenOk } from './helpers';
import type { Call } from './helpers';

/** A tiny Xero: contacts, invoices keyed by number (duplicates refused), attachments. */
function fakeXero(opts: { totalDelta?: number; loseFirstReply?: boolean } = {}) {
  const invoices = new Map<
    string,
    { InvoiceID: string; InvoiceNumber: string; Status: string; Total: number; files: string[] }
  >();
  const contacts = new Map<string, string>();
  const idem = new Map<string, unknown>();
  let creates = 0;
  let lost = false;
  const handler = (c: Call): Response | undefined => {
    const url = new URL(c.url);
    const path = url.pathname.replace('/api.xro/2.0', '');
    if (path === '/Contacts' && c.method === 'GET') {
      const term = (url.searchParams.get('searchTerm') ?? '').toLowerCase();
      return json(200, {
        Contacts: [...contacts.entries()]
          .filter(([n]) => n.toLowerCase().includes(term))
          .map(([Name, ContactID]) => ({ Name, ContactID })),
      });
    }
    if (path === '/Contacts' && c.method === 'PUT') {
      const { Contacts } = JSON.parse(c.body!) as { Contacts: { Name: string }[] };
      const id = `contact-${contacts.size + 1}`;
      contacts.set(Contacts[0]!.Name, id);
      return json(200, { Contacts: [{ ContactID: id, Name: Contacts[0]!.Name }] });
    }
    if (path === '/Invoices' && c.method === 'PUT') {
      const key = c.headers['idempotency-key']!;
      if (idem.has(key)) return json(200, idem.get(key));
      const inv = (
        JSON.parse(c.body!) as {
          Invoices: {
            InvoiceNumber: string;
            Status: string;
            LineItems: { LineAmount: number; TaxAmount?: number; TaxType: string }[];
          }[];
        }
      ).Invoices[0]!;
      if (invoices.has(inv.InvoiceNumber)) {
        return json(400, {
          Elements: [{ ValidationErrors: [{ Message: 'Invoice # must be unique.' }] }],
        });
      }
      creates += 1;
      const net = inv.LineItems.reduce((s, l) => s + l.LineAmount, 0);
      const vat = inv.LineItems.reduce(
        (s, l) => s + (l.TaxAmount ?? Math.round(l.LineAmount * 20) / 100),
        0,
      );
      const made = {
        InvoiceID: `xi-${inv.InvoiceNumber}`,
        InvoiceNumber: inv.InvoiceNumber,
        Status: inv.Status,
        Total: Math.round((net + vat) * 100) / 100 + (opts.totalDelta ?? 0),
        files: [] as string[],
      };
      invoices.set(inv.InvoiceNumber, made);
      const reply = { Invoices: [made] };
      idem.set(key, reply);
      if (opts.loseFirstReply && !lost) {
        lost = true;
        return json(503, {}); // created, but the caller never saw it
      }
      return json(200, reply);
    }
    if (path === '/Invoices' && c.method === 'GET') {
      const n = url.searchParams.get('InvoiceNumbers')!;
      return json(200, { Invoices: invoices.has(n) ? [invoices.get(n)] : [] });
    }
    const att = /^\/Invoices\/([^/]+)\/Attachments(?:\/(.+))?$/.exec(path);
    if (att) {
      const inv = [...invoices.values()].find((i) => i.InvoiceID === att[1]);
      if (!inv) return json(404, {});
      if (c.method === 'PUT') {
        inv.files.push(decodeURIComponent(att[2]!));
        return json(200, { Attachments: [] });
      }
      return json(200, { Attachments: inv.files.map((FileName) => ({ FileName })) });
    }
    const one = /^\/Invoices\/([^/]+)$/.exec(path);
    if (one && c.method === 'GET') {
      const inv = [...invoices.values()].find((i) => i.InvoiceID === one[1]);
      return inv ? json(200, { Invoices: [inv] }) : json(404, {});
    }
    return undefined;
  };
  return { handler, invoices, contacts, creates: () => creates };
}

function harness(
  fake: ReturnType<typeof fakeXero>,
  over: Partial<PushDeps> = {},
  source: Partial<InvoiceSource> = {},
) {
  const m = memoryStore();
  const x = scriptedFetch([
    (c) => (c.url.includes('/connect/token') ? tokenOk(1) : undefined),
    fake.handler,
  ]);
  const client = new XeroClient({
    env: { clientId: 'a', clientSecret: 'b' },
    store: m.store,
    fetch: x.fn,
    now: () => NOW,
    sleep: async () => undefined,
  });
  const results: {
    id: string;
    ok: boolean;
    xeroId: string | null;
    status: string | null;
    total: number | null;
    error: string | null;
  }[] = [];
  const saved: [string, string][] = [];
  const doc = auditInvoice(4001);
  const deps: PushDeps = {
    client,
    settings: DEFAULT_XERO_SETTINGS,
    now: () => NOW,
    deadline: NOW.getTime() + 60_000,
    log: () => undefined,
    claim: async () => ['inv-1'],
    load: async () => ({
      doc,
      clientId: 'client-1',
      xeroContactId: null,
      storagePath: 'invoices/4001/x/invoice.pdf',
      fileName: 'Invoice 4001.pdf',
      xeroInvoiceId: null,
      ...source,
    }),
    saveContact: async (clientId, contactId) => void saved.push([clientId, contactId]),
    pdf: async () => new Uint8Array([37, 80, 68, 70]),
    record: async (id, ok, xeroId, status, total, error) =>
      void results.push({ id, ok, xeroId, status, total, error }),
    ...over,
  };
  return { deps, results, saved, doc, calls: x.calls };
}

describe('pushing an invoice', () => {
  it('creates the contact once, the invoice with its idempotency key, and the PDF', async () => {
    const fake = fakeXero();
    const h = harness(fake);
    const counts = await pushBatch(h.deps);
    expect(counts).toMatchObject({ claimed: 1, synced: 1, mismatch: 0, failed: 0 });
    expect(h.saved).toEqual([['client-1', 'contact-1']]);
    const put = h.calls.find((c) => c.method === 'PUT' && c.url.endsWith('/Invoices'))!;
    expect(put.headers['idempotency-key']).toMatch(/^thc-invoice-4001-[0-9a-f]{12}$/);
    expect(fake.invoices.get('4001')!.files).toEqual(['Invoice 4001.pdf']);
    expect(h.results).toEqual([
      {
        id: 'inv-1',
        ok: true,
        xeroId: 'xi-4001',
        status: 'DRAFT',
        total: h.doc.total as number,
        error: null,
      },
    ]);
  });

  it('reuses a contact already matched on the client card', async () => {
    const fake = fakeXero();
    const h = harness(fake, {}, { xeroContactId: 'contact-9' });
    await pushBatch(h.deps);
    expect(h.calls.some((c) => c.url.includes('/Contacts'))).toBe(false);
    expect(h.saved).toEqual([]);
  });

  it('finds an existing contact by name instead of creating a second', async () => {
    const fake = fakeXero();
    fake.contacts.set("Jurys Inn & Leonardo Hotels UK & Ire St Paul's M & E", 'existing-1');
    const h = harness(fake);
    await pushBatch(h.deps);
    expect(h.saved).toEqual([['client-1', 'existing-1']]);
  });

  it('skips the attachment when attach_pdf is off', async () => {
    const fake = fakeXero();
    const h = harness(fake, { settings: { ...DEFAULT_XERO_SETTINGS, attach_pdf: false } });
    await pushBatch(h.deps);
    expect(fake.invoices.get('4001')!.files).toEqual([]);
  });

  it('recovers from a lost reply: the retry adopts the invoice Xero already holds', async () => {
    const fake = fakeXero({ loseFirstReply: true });
    const first = harness(fake);
    // Attempt 1: Xero created it but the reply was a 503 on every retry-able attempt budget.
    const c1 = await pushBatch(first.deps);
    // The idempotency key makes the client's own retry return the first answer.
    expect(c1.synced).toBe(1);
    expect(fake.creates()).toBe(1);

    // Attempt 2, as a fresh run with the key changed (settings edited): InvoiceNumber uniqueness refuses
    // the duplicate, and the invoice is adopted, not created twice.
    const second = harness(fake, {
      settings: { ...DEFAULT_XERO_SETTINGS, invoice_status: 'SUBMITTED' },
    });
    const c2 = await pushBatch(second.deps);
    expect(fake.creates()).toBe(1);
    expect(c2).toMatchObject({ synced: 1, adopted: 1, failed: 0 });
    expect(second.results[0]).toMatchObject({ ok: true, xeroId: 'xi-4001' });
    // The PDF is not attached twice.
    expect(fake.invoices.get('4001')!.files).toEqual(['Invoice 4001.pdf']);
  });

  it('uses the recorded Xero id after an attach failure, without creating again', async () => {
    const fake = fakeXero();
    const failing = harness(fake, { pdf: async () => null });
    const c1 = await pushBatch(failing.deps);
    expect(c1.failed).toBe(1);
    expect(failing.results[0]).toMatchObject({ ok: false, xeroId: 'xi-4001' });
    expect(failing.results[0]!.error).toMatch(/PDF/);

    const retry = harness(fake, {}, { xeroInvoiceId: 'xi-4001' });
    const c2 = await pushBatch(retry.deps);
    expect(c2).toMatchObject({ synced: 1, adopted: 1 });
    expect(fake.creates()).toBe(1);
    expect(fake.invoices.get('4001')!.files).toEqual(['Invoice 4001.pdf']);
  });

  it('hands Xero\'s total to the database even when it differs by a penny (the DB records "mismatch")', async () => {
    const fake = fakeXero({ totalDelta: 0.01 });
    const h = harness(fake);
    const counts = await pushBatch(h.deps);
    expect(counts).toMatchObject({ mismatch: 1, synced: 0, failed: 0 });
    expect(h.results[0]).toMatchObject({ ok: true, total: (h.doc.total as number) + 0.01 });
  });

  it('records a Xero validation failure (e.g. a wrong account code) as failed, with its text', async () => {
    const fake = fakeXero();
    const bad = scriptedFetch([
      (c) => (c.url.includes('/connect/token') ? tokenOk(1) : undefined),
      (c) =>
        c.method === 'PUT' && c.url.endsWith('/Invoices')
          ? json(400, {
              Elements: [
                { ValidationErrors: [{ Message: "Account code '200' is not a valid code" }] },
              ],
            })
          : fake.handler(c),
    ]);
    const h = harness(fake);
    const m = memoryStore();
    h.deps.client = new XeroClient({
      env: { clientId: 'a', clientSecret: 'b' },
      store: m.store,
      fetch: bad.fn,
      now: () => NOW,
      sleep: async () => undefined,
    });
    const counts = await pushBatch(h.deps);
    expect(counts.failed).toBe(1);
    expect(h.results[0]).toMatchObject({
      ok: false,
      error: "Account code '200' is not a valid code",
    });
  });

  it('stops on a rate limit it will not wait out, handing the rest back for the next run', async () => {
    const fake = fakeXero();
    const m = memoryStore();
    const limited = scriptedFetch([
      () => json(429, {}, { 'retry-after': '3600', 'x-rate-limit-problem': 'daily' }),
    ]);
    const h = harness(fake, { claim: async () => ['a', 'b', 'c'] });
    h.deps.client = new XeroClient({
      env: { clientId: 'a', clientSecret: 'b' },
      store: m.store,
      fetch: limited.fn,
      now: () => NOW,
      sleep: async () => undefined,
    });
    const counts = await pushBatch(h.deps);
    expect(counts).toMatchObject({ claimed: 3, failed: 3, stopped: 'rate_limit' });
    expect(limited.calls).toHaveLength(1); // b and c never touched Xero
    expect(h.results.map((r) => r.error)).toEqual([
      expect.stringMatching(/rate limit/i),
      expect.stringMatching(/rate limit/i),
      expect.stringMatching(/rate limit/i),
    ]);
  });
});

/** A database that answers the few reads runXeroSync makes before it claims anything. */
function fakeDb(opts: { settings?: unknown; connected: boolean }) {
  const rpcs: string[] = [];
  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'settings' && opts.settings ? { value: opts.settings } : null,
          }),
        }),
        maybeSingle: async () => ({
          data:
            table === 'xero_connection' && opts.connected
              ? {
                  tenant_id: 't',
                  tenant_name: 'THC',
                  access_token: 'a',
                  refresh_token: 'r',
                  expires_at: new Date(NOW.getTime() + 600_000).toISOString(),
                }
              : null,
        }),
      }),
    }),
    rpc: async (fn: string) => {
      rpcs.push(fn);
      return { data: [], error: null };
    },
  } as unknown as AdminDb;
  return { db, rpcs };
}

describe('off and harmless', () => {
  const env = {
    clientId: 'a',
    clientSecret: 'b',
    redirectUri: 'https://x/api/xero/callback',
    scopes: 's',
  };
  const unreachable = (async () => {
    throw new Error('Xero must not be called');
  }) as unknown as typeof fetch;

  it('without the env vars nothing is read or claimed', async () => {
    const f = fakeDb({ settings: { enabled: true }, connected: true });
    const out = await runXeroSync(f.db, {
      deadline: Date.now() + 1000,
      env: null,
      fetch: unreachable,
    });
    expect(out).toEqual({ ran: false, reason: 'not_configured' });
    expect(f.rpcs).toEqual([]);
  });

  it('with settings.xero.enabled false nothing is claimed', async () => {
    const f = fakeDb({ settings: { enabled: false }, connected: true });
    const out = await runXeroSync(f.db, { deadline: Date.now() + 1000, env, fetch: unreachable });
    expect(out).toEqual({ ran: false, reason: 'disabled' });
    expect(f.rpcs).toEqual([]);
  });

  it('with no organisation connected nothing is claimed', async () => {
    const f = fakeDb({ settings: { enabled: true }, connected: false });
    const out = await runXeroSync(f.db, { deadline: Date.now() + 1000, env, fetch: unreachable });
    expect(out).toEqual({ ran: false, reason: 'not_connected' });
    expect(f.rpcs).toEqual([]);
  });

  it('enabled and connected claims a batch (and an empty one is a quiet success)', async () => {
    const f = fakeDb({ settings: { enabled: true }, connected: true });
    const out = await runXeroSync(f.db, {
      deadline: Date.now() + 1000,
      env,
      fetch: unreachable,
      now: NOW,
    });
    expect(out).toMatchObject({ ran: true, counts: { claimed: 0 } });
    expect(f.rpcs).toEqual(['xero_claim_batch']);
  });
});
