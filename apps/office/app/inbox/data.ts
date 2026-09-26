import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OFFICE_INBOX_CODES } from '@thc/notifications';
import type { OfficeInboxCode } from '@thc/notifications';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';
import { type InboxStatus, type Period, periodStart } from './filters';
import type { InboxRow } from './view-model';

export const PAGE_SIZE = 50;

export interface InboxFilters {
  type: OfficeInboxCode | null;
  status: InboxStatus | null;
  period: Period;
  before: number | null;
}

export interface InboxPageData {
  rows: InboxRow[];
  /** Office emails failed in the period, whatever the other filters say. */
  failedInPeriod: number;
  /** The id to page from for "Older", when there may be more. */
  nextBefore: number | null;
  problem: string | null;
}

const COLUMNS =
  'id, key, template, recipient_emails, payload, queued_at, send_after, sent_at, failed_at, error, attempts';

/**
 * Read straight from `notification_outbox` under its `admin_read` policy
 * (001_rls_guard assertion 8): a worker or a client reads nothing here, and
 * nothing on this page writes. Only the office emails — the codes whose
 * recipients the register pins (`OFFICE_INBOX_CODES`) — so a candidate's E3
 * or a new login's E11, which carry live set-up links, never appear.
 */
export async function loadInbox(filters: InboxFilters, now = new Date()): Promise<InboxPageData> {
  const empty = { rows: [], failedInPeriod: 0, nextBefore: null };
  if (!supabaseConfigured()) {
    return {
      ...empty,
      problem:
        'This environment has no Supabase project, so there are no emails to show. See docs/04-setup-github-vercel-supabase.md.',
    };
  }
  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const since = periodStart(filters.period, now);
  const codes: readonly string[] = filters.type ? [filters.type] : OFFICE_INBOX_CODES;

  let list = supabase
    .from('notification_outbox')
    .select(COLUMNS)
    .eq('channel', 'email')
    .in('template', [...codes]);
  if (filters.status === 'sent') list = list.not('sent_at', 'is', null).is('failed_at', null);
  if (filters.status === 'failed') list = list.not('failed_at', 'is', null);
  if (filters.status === 'queued') list = list.is('sent_at', null).is('failed_at', null);
  if (since) list = list.gte('queued_at', since);
  if (filters.before) list = list.lt('id', filters.before);

  let failed = supabase
    .from('notification_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'email')
    .in('template', [...OFFICE_INBOX_CODES])
    .not('failed_at', 'is', null);
  if (since) failed = failed.gte('queued_at', since);

  const [rows, failures] = await Promise.all([
    list.order('id', { ascending: false }).limit(PAGE_SIZE),
    failed,
  ]);
  const data = (rows.data ?? []) as unknown as InboxRow[];
  return {
    rows: data,
    failedInPeriod: failures.count ?? 0,
    nextBefore: data.length === PAGE_SIZE ? (data[data.length - 1]?.id ?? null) : null,
    problem: rows.error?.message ?? failures.error?.message ?? null,
  };
}
