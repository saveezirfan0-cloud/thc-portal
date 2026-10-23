/* eslint-disable @typescript-eslint/no-explicit-any -- the generated Database
   type is regenerated from the live project (`pnpm --filter @thc/db gen:types`)
   and does not know `tickets` / `ticket_comments` until it is run after
   20261025110000, so these reads go through an untyped client and are
   given their row types here. Same narrowing as _components/officeUser.ts. */

import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { readProblem } from '../_lib/dbError';
import { PAGE_SIZE, ilikePattern, ticketNumberOf } from './view-model';
import type { ScopeLabel, TicketQuery, TimeRow, Worker } from './view-model';
import type { RunningTimer, Ticket, TicketComment, TicketScope, TimeEntry } from './types';

/**
 * Reads for /tickets (ADR-0202), straight from `tickets` and
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
  'id, ticket_no, kind, severity, status, title, details, page_path, link_url, reporter_id, reporter_name, assignee_id, assignee_name, resolution, created_at, updated_at, resolved_at';

async function client(): Promise<SupabaseClient<any, 'public', any>> {
  return createClient(await cookies()) as unknown as SupabaseClient<any, 'public', any>;
}

export interface TicketsPageData {
  tickets: Ticket[];
  /** The owner's own labels for the tickets on this page; empty for anyone else. */
  scopes: Record<string, ScopeLabel>;
  /** May this login see labels and time (ADR-0202)? Decides whether the filter and pills show. */
  tracker: boolean;
  total: number;
  /** Open tickets, whatever the filters — the number on the Open tab. */
  open: number;
  closed: number;
  problem: string | null;
}

const EMPTY: Omit<TicketsPageData, 'problem'> = {
  tickets: [],
  scopes: {},
  tracker: false,
  total: 0,
  open: 0,
  closed: 0,
};

/** May this login see and keep ticket labels and time? The database answers; a failure is "no". */
export async function trackerAllowed(
  supabase: SupabaseClient<any, 'public', any>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('ticket_tracker_allowed');
  return !error && data === true;
}

export async function loadTickets(query: TicketQuery): Promise<TicketsPageData> {
  if (!supabaseConfigured()) return { ...EMPTY, problem: NOT_CONFIGURED };
  const supabase = await client();

  const tracker = await trackerAllowed(supabase);

  let list = supabase.from('tickets').select(TICKET_COLUMNS, { count: 'exact' });
  if (tracker && query.scope) {
    // The label lives in its own table, so the filter is the set of ids it names.
    const labelled = await supabase.from('ticket_scope').select('ticket_id, label');
    const rows = (labelled.data ?? []) as { ticket_id: string; label: ScopeLabel }[];
    if (query.scope === 'none') {
      if (rows.length > 0)
        list = list.not('id', 'in', `(${rows.map((r) => r.ticket_id).join(',')})`);
    } else {
      const ids = rows.filter((r) => r.label === query.scope).map((r) => r.ticket_id);
      list = list.in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
    }
  }
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
  const tickets = (rows.data ?? []) as Ticket[];
  const scopes: Record<string, ScopeLabel> = {};
  if (tracker && tickets.length > 0) {
    const labelled = await supabase
      .from('ticket_scope')
      .select('ticket_id, label')
      .in(
        'ticket_id',
        tickets.map((t) => t.id),
      );
    for (const row of (labelled.data ?? []) as { ticket_id: string; label: ScopeLabel }[]) {
      scopes[row.ticket_id] = row.label;
    }
  }
  return {
    tickets,
    scopes,
    tracker,
    total: rows.count ?? 0,
    open: open.count ?? 0,
    closed: closed.count ?? 0,
    problem: null,
  };
}

export interface TicketPageData {
  ticket: Ticket | null;
  comments: TicketComment[];
  /** The office logins a ticket can be given to (the Owner picker). */
  assignees: { id: string; full_name: string }[];
  problem: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One ticket and its thread; `ticket: null` and no problem is "not found". */
export async function loadTicket(id: string): Promise<TicketPageData> {
  if (!UUID.test(id)) return { ticket: null, comments: [], assignees: [], problem: null };
  if (!supabaseConfigured())
    return { ticket: null, comments: [], assignees: [], problem: NOT_CONFIGURED };
  const supabase = await client();
  const [ticket, comments, assignees] = await Promise.all([
    supabase.from('tickets').select(TICKET_COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('ticket_comments')
      .select('id, ticket_id, kind, activity, body, author_id, author_name, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    supabase.rpc('ticket_assignees'),
  ]);
  const error = ticket.error ?? comments.error;
  if (error) return { ticket: null, comments: [], assignees: [], problem: readProblem(error) };
  return {
    ticket: (ticket.data ?? null) as Ticket | null,
    comments: (comments.data ?? []) as TicketComment[],
    // A failed picker is an empty picker, not a failed page.
    assignees: assignees.error
      ? []
      : ((assignees.data ?? []) as { id: string; full_name: string }[]),
    problem: null,
  };
}

export interface TrackingData {
  /** False for everyone but the owner who tracks: the panel is not drawn at all. */
  allowed: boolean;
  scope: TicketScope | null;
  entries: TimeEntry[];
  /** The signed-in login's own running timer, on any ticket. */
  running: RunningTimer | null;
  problem: string | null;
}

const NO_TRACKING: TrackingData = {
  allowed: false,
  scope: null,
  entries: [],
  running: null,
  problem: null,
};

/** The caller's running timer with the ticket it is on, or null. Tracker only (the database enforces it). */
export async function loadRunningTimer(
  supabase: SupabaseClient<any, 'public', any>,
): Promise<RunningTimer | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('ticket_time')
    .select('id, ticket_id, worked_by, started_at')
    .eq('logged_by', auth.user.id)
    .not('started_at', 'is', null)
    .is('ended_at', null)
    .maybeSingle();
  if (!data) return null;
  const { data: ticket } = await supabase
    .from('tickets')
    .select('ticket_no, title')
    .eq('id', data.ticket_id)
    .maybeSingle();
  if (!ticket) return null;
  return {
    id: data.id as number,
    ticket_id: data.ticket_id as string,
    ticket_no: ticket.ticket_no as number,
    title: ticket.title as string,
    worked_by: data.worked_by as Worker,
    started_at: data.started_at as string,
  };
}

/** The owner's label, time entries and running timer for one ticket (ADR-0202). */
export async function loadTracking(ticketId: string): Promise<TrackingData> {
  if (!supabaseConfigured()) return NO_TRACKING;
  const supabase = await client();
  if (!(await trackerAllowed(supabase))) return NO_TRACKING;
  const [scope, entries, running] = await Promise.all([
    supabase
      .from('ticket_scope')
      .select('ticket_id, label, note')
      .eq('ticket_id', ticketId)
      .maybeSingle(),
    supabase
      .from('ticket_time')
      .select(
        'id, ticket_id, worked_by, worked_on, started_at, ended_at, minutes, billable, note, logged_by',
      )
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false }),
    loadRunningTimer(supabase),
  ]);
  const error = scope.error ?? entries.error;
  if (error) return { ...NO_TRACKING, allowed: true, problem: readProblem(error) };
  return {
    allowed: true,
    scope: (scope.data ?? null) as TicketScope | null,
    entries: (entries.data ?? []) as TimeEntry[],
    running,
    problem: null,
  };
}

export interface MonthReport {
  allowed: boolean;
  rows: TimeRow[];
  /** Timers still running: not in the totals until stopped. */
  running: number;
  problem: string | null;
}

/** Every finished time entry worked in a month (UK dates), with its ticket and label. */
export async function loadMonthReport(from: string, to: string): Promise<MonthReport> {
  const none: MonthReport = { allowed: false, rows: [], running: 0, problem: null };
  if (!supabaseConfigured()) return none;
  const supabase = await client();
  if (!(await trackerAllowed(supabase))) return none;
  const { data, error } = await supabase
    .from('ticket_time')
    .select('ticket_id, worked_by, worked_on, minutes, billable, note, started_at, ended_at')
    .gte('worked_on', from)
    .lt('worked_on', to)
    .order('worked_on', { ascending: true })
    .order('id', { ascending: true });
  if (error) return { ...none, allowed: true, problem: readProblem(error) };
  const entries = (data ?? []) as {
    ticket_id: string;
    worked_by: Worker;
    worked_on: string;
    minutes: number | null;
    billable: boolean;
    note: string | null;
    started_at: string | null;
    ended_at: string | null;
  }[];
  const ids = [...new Set(entries.map((e) => e.ticket_id))];
  const [tickets, scopes] = await Promise.all([
    ids.length
      ? supabase.from('tickets').select('id, ticket_no, title').in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from('ticket_scope').select('ticket_id, label').in('ticket_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tickets.error ?? scopes.error) {
    return { ...none, allowed: true, problem: readProblem((tickets.error ?? scopes.error)!) };
  }
  const byId = new Map(
    ((tickets.data ?? []) as { id: string; ticket_no: number; title: string }[]).map((t) => [
      t.id,
      t,
    ]),
  );
  const label = new Map(
    ((scopes.data ?? []) as { ticket_id: string; label: ScopeLabel }[]).map((r) => [
      r.ticket_id,
      r.label,
    ]),
  );
  const rows: TimeRow[] = [];
  let running = 0;
  for (const e of entries) {
    if (e.minutes === null) {
      running += 1;
      continue;
    }
    const t = byId.get(e.ticket_id);
    if (!t) continue;
    rows.push({
      ticketNo: t.ticket_no,
      title: t.title,
      label: label.get(e.ticket_id) ?? null,
      workedBy: e.worked_by,
      workedOn: e.worked_on,
      minutes: e.minutes,
      billable: e.billable,
      note: e.note,
    });
  }
  return { allowed: true, rows, running, problem: null };
}
