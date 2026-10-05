import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SWITCHED_OFF_ERROR, emailAudienceCodes } from '@thc/notifications';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';
import { type Audience, type InboxStatus, type Period, periodStart } from './filters';
import type { InboxRow } from './view-model';

export const PAGE_SIZE = 50;

export interface InboxFilters {
  audience: Audience;
  /** Search text: part of an address, a name or an Employee ID. */
  q: string | null;
  type: string | null;
  status: InboxStatus | null;
  period: Period;
  before: number | null;
}

export interface InboxPageData {
  rows: InboxRow[];
  /** Emails of this audience failed in the period, whatever the other filters say. */
  failedInPeriod: number;
  /** The id to page from for "Older", when there may be more. */
  nextBefore: number | null;
  problem: string | null;
}

/**
 * Read through `office_email_log()` and `office_email_failures()`
 * (20261005120500, ADR-0086): Back Office logins only, read-only, and the
 * payload comes back reduced to the values that fill the subject line, so a
 * candidate's or a new login's set-up link (E3, E11, OC2) never reaches this
 * page even for the owners who may read it on the table. The office emails
 * were read straight from `notification_outbox` before; the shape of a row
 * is the same. The codes asked for are the register's for the audience
 * (`EMAIL_AUDIENCES`), so a code added there is on the page.
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
  const audienceCodes = emailAudienceCodes(filters.audience);
  const codes = filters.type ? [filters.type] : audienceCodes;

  const [rows, failures] = await Promise.all([
    supabase.rpc('office_email_log', {
      p_templates: codes,
      p_status: filters.status,
      p_since: since,
      p_before: filters.before,
      p_search: filters.q,
      p_limit: PAGE_SIZE,
    }),
    // An email switched off on /settings → Notifications was not sent on
    // purpose (ADR-0083); it is listed with its reason, not counted as a failure.
    supabase.rpc('office_email_failures', {
      p_templates: audienceCodes,
      p_since: since,
      p_ignore_error: SWITCHED_OFF_ERROR,
    }),
  ]);
  const data = (rows.data ?? []) as unknown as InboxRow[];
  return {
    rows: data,
    failedInPeriod: typeof failures.data === 'number' ? failures.data : 0,
    nextBefore: data.length === PAGE_SIZE ? (data[data.length - 1]?.id ?? null) : null,
    problem: rows.error?.message ?? failures.error?.message ?? null,
  };
}
