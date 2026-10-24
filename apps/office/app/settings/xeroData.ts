import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { xeroEnv } from '../api/xero/_lib/config';
import { readXeroSettings } from '../api/xero/_lib/settings';
import type { XeroSettings } from '../api/xero/_lib/settings';
import { supabaseConfigured } from './data';

/** What the Xero tab shows (never a token). */
export interface XeroTabData {
  /** XERO_CLIENT_ID / _SECRET / _REDIRECT_URI are all set on this deployment. */
  envConfigured: boolean;
  settings: XeroSettings;
  connected: boolean;
  tenantName: string | null;
  connectedAt: string | null;
  open: number;
  problem: string | null;
  rows: XeroRow[];
}

export interface XeroRow {
  invoiceId: string;
  number: number | null;
  status: 'pending' | 'syncing' | 'failed' | 'mismatch';
  attempts: number;
  lastError: string | null;
  xeroTotal: number | null;
  ourTotal: number | null;
  updatedAt: string;
}

interface RowShape {
  invoice_id: string;
  status: XeroRow['status'];
  attempts: number;
  last_error: string | null;
  xero_total: number | string | null;
  updated_at: string;
  invoices:
    | { number: number; total: number | string }
    | { number: number; total: number | string }[]
    | null;
}

export const EMPTY_XERO: XeroTabData = {
  envConfigured: false,
  settings: readXeroSettings(null),
  connected: false,
  tenantName: null,
  connectedAt: null,
  open: 0,
  problem: null,
  rows: [],
};

export async function loadXeroTab(): Promise<XeroTabData> {
  const envConfigured = xeroEnv() !== null;
  if (!supabaseConfigured()) return { ...EMPTY_XERO, envConfigured };
  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  try {
    const [setting, status, rows] = await Promise.all([
      supabase.from('settings').select('value').eq('key', 'xero').maybeSingle(),
      supabase.rpc('xero_status'),
      supabase
        .from('xero_sync')
        .select(
          'invoice_id, status, attempts, last_error, xero_total, updated_at, invoices(number, total)',
        )
        .in('status', ['failed', 'mismatch', 'pending', 'syncing'])
        .order('updated_at', { ascending: false })
        .limit(50)
        .returns<RowShape[]>(),
    ]);
    const s = (status.data ?? {}) as {
      connected?: boolean;
      tenantName?: string | null;
      connectedAt?: string | null;
      open?: number;
    };
    return {
      envConfigured,
      settings: readXeroSettings(setting.data?.value),
      connected: s.connected === true,
      tenantName: s.tenantName ?? null,
      connectedAt: s.connectedAt ?? null,
      open: Number(s.open ?? 0),
      problem: status.error || rows.error ? 'The Xero status could not be read.' : null,
      rows: (rows.data ?? []).map((r) => {
        const inv = Array.isArray(r.invoices) ? r.invoices[0] : r.invoices;
        return {
          invoiceId: r.invoice_id,
          number: inv?.number ?? null,
          status: r.status,
          attempts: r.attempts,
          lastError: r.last_error,
          xeroTotal: r.xero_total === null ? null : Number(r.xero_total),
          ourTotal: inv ? Number(inv.total) : null,
          updatedAt: r.updated_at,
        };
      }),
    };
  } catch {
    return { ...EMPTY_XERO, envConfigured, problem: 'The Xero status could not be read.' };
  }
}
