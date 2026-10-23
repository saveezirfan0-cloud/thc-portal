/* eslint-disable @typescript-eslint/no-explicit-any -- the generated Database
   type is regenerated from the live project (`pnpm --filter @thc/db gen:types`)
   and does not know `tickets` / `ticket_comments` until it is run after
   20261024120000, so these reads go through an untyped client and are
   given their row types here. Same narrowing as _components/officeUser.ts. */

import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { readProblem } from '../_lib/dbError';
import { PAGE_SIZE, ilikePattern, ticketNumberOf } from './view-model';
import type { TicketQuery } from './view-model';
import type { Ticket, TicketComment } from './types';

/**
 * Reads for /tickets (ADR-0198), straight from `tickets` and
 * `ticket_comments`: one admin_read policy each, so any Back Office login
 * (a Viewer too) reads every ticket and nobody else reads any. Writes are
 * the RPCs in actions.ts.
 */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

const NOT_CONFIGURED =
  'This environment has no Supabase project, so tickets cannot be read. See docs/04-setup-github-vercel-supabase.md.';

export const TICKET_COLUMNS =
  'id, ticket_no, kind, severity, status, title, details, page_path, link_url, reporter_id, reporter_name, created_at, updated_at, resolved_at';

async function client(): Promise<SupabaseClient<any, 'public', any>> {
  return createClient(await cookies()) as unknown as SupabaseClient<any, 'public', any>;
}

export interface TicketsPageData {
  tickets: Ticket[];
  total: number;
  /** Open tickets, whatever the filters — the number on the Open tab. */
  open: number;
  closed: number;
  problem: string | null;
}

const EMPTY: Omit<TicketsPageData, 'problem'> = { tickets: [], total: 0, open: 0, closed: 0 };

export async function loadTickets(query: TicketQuery): Promise<TicketsPageData> {
  if (!supabaseConfigured()) return { ...EMPTY, problem: NOT_CONFIGURED };
  const supabase = await client();

  let list = supabase.from('tickets').select(TICKET_COLUMNS, { count: 'exact' });
  if (query.tab === 'open') list = list.in('status', ['new', 'in_progress', 'waiting']);
  if (query.tab === 'closed') list = list.in('status', ['resolved', 'closed']);
  if (query.status) list = list.eq('status', query.status);
  if (query.kind) list = list.eq('kind', query.kind);
  if (query.severity) list = list.eq('severity', query.severity);
  if (query.q) {
    const no = ticketNumberOf(query.q);
    const like = ilikePattern(query.q);
    list = list.or(
      `${no === null ? '' : `ticket_no.eq.${no},`}title.ilike.${like},details.ilike.${like},reporter_name.ilike.${like}`,
    );
  }
  const from = (query.page - 1) * PAGE_SIZE;
  const page = list.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);

  const [rows, open, closed] = await Promise.all([
    page,
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'in_progress', 'waiting']),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', ['resolved', 'closed']),
  ]);

  // A page past the end is a PostgREST range error (416): an empty list.
  const error = rows.error ?? open.error ?? closed.error;
  if (error && !(rows.error && rows.status === 416)) {
    return { ...EMPTY, problem: readProblem(error) };
  }
  return {
    tickets: (rows.data ?? []) as Ticket[],
    total: rows.count ?? 0,
    open: open.count ?? 0,
    closed: closed.count ?? 0,
    problem: null,
  };
}

export interface TicketPageData {
  ticket: Ticket | null;
  comments: TicketComment[];
  problem: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One ticket and its thread; `ticket: null` and no problem is "not found". */
export async function loadTicket(id: string): Promise<TicketPageData> {
  if (!UUID.test(id)) return { ticket: null, comments: [], problem: null };
  if (!supabaseConfigured()) return { ticket: null, comments: [], problem: NOT_CONFIGURED };
  const supabase = await client();
  const [ticket, comments] = await Promise.all([
    supabase.from('tickets').select(TICKET_COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('ticket_comments')
      .select('id, ticket_id, kind, body, author_id, author_name, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);
  const error = ticket.error ?? comments.error;
  if (error) return { ticket: null, comments: [], problem: readProblem(error) };
  return {
    ticket: (ticket.data ?? null) as Ticket | null,
    comments: (comments.data ?? []) as TicketComment[],
    problem: null,
  };
}
