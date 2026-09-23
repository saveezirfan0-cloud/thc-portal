import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { PAGE_SIZE, ilikePattern } from './view-model';
import type { FeedbackEntry, FeedbackQuery, Option } from './types';

/**
 * Reads for /feedback (§9.10).
 *
 * Everything comes from `feedback_entries_v` and `feedback_authors_v`
 * (20260923140000). Both run with owner rights and return rows to an admin
 * only (ADR-0016), because §9.10 names authors from `profiles` and an admin
 * cannot read a colleague's profile directly.
 *
 * The list is paged on the server: §9.10 is "every piece of feedback about
 * workers", and a year of it is thousands of rows.
 */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export const ENTRY_COLUMNS =
  'id, author_kind, rating, text, created_at, updated_at, read_at, read_by_name, unread, ' +
  'counts_toward_rating, editable, deletable, author_id, author_name, staff_id, staff_name, ' +
  'employee_id, staff_removed, staff_removed_at, event_id, event_title, event_date, venue_name, ' +
  'client_id, client_name, role_names';

export interface FeedbackPageData {
  entries: FeedbackEntry[];
  total: number;
  /** Client entries nobody has marked read — the badge, whatever the filters. */
  unread: number;
  clients: Option[];
  authors: Option[];
  /** The signed-in manager: the author of anything they add (§9.10). */
  managerName: string | null;
  problem: string | null;
}

const EMPTY: Omit<FeedbackPageData, 'problem'> = {
  entries: [],
  total: 0,
  unread: 0,
  clients: [],
  authors: [],
  managerName: null,
};

export async function loadFeedback(query: FeedbackQuery): Promise<FeedbackPageData> {
  if (!supabaseConfigured()) {
    return {
      ...EMPTY,
      problem:
        'This environment has no Supabase project, so feedback cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = createClient(await cookies());

  let list = supabase
    .from('feedback_entries_v')
    .select(ENTRY_COLUMNS, { count: 'exact' })
    .eq('author_kind', query.tab);

  if (query.q) list = list.ilike('staff_name', ilikePattern(query.q));

  if (query.tab === 'client') {
    if (query.clientId) list = list.eq('client_id', query.clientId);
    if (query.status === 'unread') list = list.eq('unread', true);
    if (query.status === 'read') list = list.eq('unread', false);
    // Unread first — they are the inbox — then newest.
    list = list.order('unread', { ascending: false });
  } else if (query.authorId) {
    list = list.eq('author_id', query.authorId);
  }

  const from = (query.page - 1) * PAGE_SIZE;
  const ordered = list
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)
    .returns<FeedbackEntry[]>();

  const [entries, unread, clients, authors, me] = await Promise.all([
    ordered,
    supabase
      .from('feedback_entries_v')
      .select('id', { count: 'exact', head: true })
      .eq('unread', true),
    supabase.from('clients').select('id, name').order('name').returns<Option[]>(),
    supabase
      .from('feedback_authors_v')
      .select('author_id, author_name')
      .order('author_name')
      .returns<{ author_id: string; author_name: string }[]>(),
    managerName(supabase),
  ]);

  const error = entries.error ?? unread.error ?? clients.error ?? authors.error;
  // A page past the end is a PostgREST range error (416); show the empty
  // list and let the pager take the manager back, rather than an error.
  if (error && !(entries.error && entries.status === 416)) {
    return { ...EMPTY, problem: error.message };
  }

  return {
    entries: entries.data ?? [],
    total: entries.count ?? 0,
    unread: unread.count ?? 0,
    clients: clients.data ?? [],
    authors: (authors.data ?? []).map((a) => ({ id: a.author_id, name: a.author_name })),
    managerName: me,
    problem: null,
  };
}

/**
 * The signed-in manager's own name, read through `profiles_self`. §9.10:
 * the author shown is "the manager's own name, not a generic Office label",
 * and the form says so before anything is written.
 */
export async function managerName(
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', auth.user.id)
    .maybeSingle<{ full_name: string | null }>();
  return data?.full_name ?? null;
}
