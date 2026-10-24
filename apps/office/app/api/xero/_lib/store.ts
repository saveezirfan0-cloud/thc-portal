import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { XeroClient } from './client';
import type { TokenStore, XeroConnection, XeroTokens } from './client';
import { xeroEnv } from './config';
import type { XeroEnv } from './config';
import { pushBatch } from './push';
import type { InvoiceSource, PushCounts } from './push';
import { readXeroSettings } from './settings';
import type { DocData } from './map';

/**
 * The Supabase side of the Xero push (service role): the token store, the
 * claim/record functions of 20261027100000 and the lock of 20261027130000.
 * packages/db's generated types do not know these yet, so the client is
 * narrowed to an untyped one, as the other office writers do.
 */

export type AdminDb = SupabaseClient;

function connectionOf(row: Record<string, unknown>): XeroConnection {
  return {
    tenantId: String(row['tenant_id']),
    tenantName: (row['tenant_name'] as string | null) ?? null,
    accessToken: String(row['access_token']),
    refreshToken: String(row['refresh_token']),
    expiresAt: new Date(String(row['expires_at'])),
    scopes: (row['scopes'] as string | null) ?? null,
  };
}

export function supabaseTokenStore(db: AdminDb): TokenStore {
  return {
    async load() {
      const { data, error } = await db.from('xero_connection').select('*').maybeSingle();
      if (error) throw new Error('xero_connection could not be read');
      return data ? connectionOf(data as Record<string, unknown>) : null;
    },
    async tryLock(seconds) {
      const { data, error } = await db.rpc('xero_refresh_lock', { p_seconds: seconds });
      if (error) throw new Error('xero_refresh_lock failed');
      return data === true;
    },
    async unlock() {
      await db.rpc('xero_refresh_unlock');
    },
    async save(previousRefreshToken: string, tokens: XeroTokens) {
      const { data, error } = await db
        .from('xero_connection')
        .update({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_at: tokens.expiresAt.toISOString(),
          ...(tokens.scopes ? { scopes: tokens.scopes } : {}),
        })
        .eq('refresh_token', previousRefreshToken)
        .select('id');
      if (error) throw new Error('xero_connection could not be updated');
      return (data?.length ?? 0) > 0;
    },
  };
}

export function makeClient(db: AdminDb, env: XeroEnv, fetchFn?: typeof fetch): XeroClient {
  return new XeroClient({ env, store: supabaseTokenStore(db), fetch: fetchFn });
}

export type XeroRunResult =
  | { ran: false; reason: 'not_configured' | 'disabled' | 'not_connected' }
  | { ran: true; counts: PushCounts };

/** Refresh tokens die after 60 days unused; touch the connection when it has been idle a week. */
const KEEP_ALIVE_MS = 7 * 24 * 3600 * 1000;

/**
 * One pass of the push. Off and harmless without the env vars, with
 * settings.xero.enabled false, or with no organisation connected: nothing is
 * claimed, so no invoice's attempt counter moves.
 */
export async function runXeroSync(
  db: AdminDb,
  opts: {
    now?: Date;
    deadline: number;
    env?: XeroEnv | null;
    fetch?: typeof fetch;
    log?: (l: string) => void;
  },
): Promise<XeroRunResult> {
  const env = opts.env === undefined ? xeroEnv() : opts.env;
  if (!env) return { ran: false, reason: 'not_configured' };
  const now = opts.now ?? new Date();
  const log = opts.log ?? ((line: string) => console.warn(line));

  const settingsRow = await db.from('settings').select('value').eq('key', 'xero').maybeSingle();
  const settings = readXeroSettings(settingsRow.data?.value);
  if (!settings.enabled) return { ran: false, reason: 'disabled' };

  const store = supabaseTokenStore(db);
  const conn = await store.load();
  if (!conn) return { ran: false, reason: 'not_connected' };

  const client = makeClient(db, env, opts.fetch);
  if (now.getTime() - conn.expiresAt.getTime() > KEEP_ALIVE_MS) {
    try {
      await client.ensureFresh();
    } catch {
      log('xero-sync: keep-alive refresh failed');
    }
  }

  const counts = await pushBatch({
    client,
    settings,
    now: () => new Date(),
    deadline: opts.deadline,
    log,
    claim: async (limit) => {
      const { data, error } = await db.rpc('xero_claim_batch', {
        p_now: now.toISOString(),
        p_limit: limit,
      });
      if (error) throw new Error(`xero_claim_batch: ${error.message}`);
      return (data ?? []) as string[];
    },
    load: (invoiceId) => loadInvoice(db, invoiceId),
    saveContact: async (clientId, contactId) => {
      const { error } = await db
        .from('clients')
        .update({ xero_contact_id: contactId })
        .eq('id', clientId);
      if (error) throw new Error('clients.xero_contact_id could not be saved');
    },
    pdf: async (path) => {
      const { data, error } = await db.storage.from('timesheets').download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    record: async (invoice, ok, xeroInvoiceId, xeroStatus, xeroTotal, error) => {
      const { error: failed } = await db.rpc('xero_record_result', {
        p_invoice: invoice,
        p_ok: ok,
        p_xero_invoice_id: xeroInvoiceId,
        p_xero_status: xeroStatus,
        p_xero_total: xeroTotal,
        p_error: error,
      });
      if (failed) throw new Error(`xero_record_result: ${failed.message}`);
    },
  });
  return { ran: true, counts };
}

async function loadInvoice(db: AdminDb, invoiceId: string): Promise<InvoiceSource> {
  const doc = await db.rpc('invoice_document_data', { p_invoice: invoiceId });
  if (doc.error) throw new Error(`invoice_document_data: ${doc.error.message}`);
  const inv = await db
    .from('invoices')
    .select('client_id, storage_path, file_name, clients(xero_contact_id)')
    .eq('id', invoiceId)
    .single();
  if (inv.error) throw new Error('invoice could not be read');
  const sync = await db
    .from('xero_sync')
    .select('xero_invoice_id')
    .eq('invoice_id', invoiceId)
    .maybeSingle();
  const row = inv.data as unknown as {
    client_id: string;
    storage_path: string | null;
    file_name: string | null;
    clients: { xero_contact_id: string | null } | { xero_contact_id: string | null }[] | null;
  };
  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  return {
    doc: doc.data as DocData,
    clientId: row.client_id,
    xeroContactId: client?.xero_contact_id ?? null,
    storagePath: row.storage_path,
    fileName: row.file_name,
    xeroInvoiceId: (sync.data?.xero_invoice_id as string | null | undefined) ?? null,
  };
}
