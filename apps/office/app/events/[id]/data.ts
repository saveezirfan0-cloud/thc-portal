import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../db';
import type {
  BoardData,
  BoardEvent,
  BoardSection,
  CandidateRow,
  PoolPerson,
  RosterRow,
} from './types';

/**
 * Reads for /events/:id (§3.3).
 *
 * The pool is `auto_assign_candidates(shift)`, called once per role
 * section. That function has fed the engine since
 * 20260921141500_auto_assign.sql and its own comment says it was written
 * for both: "one row per worker who qualifies for the ROLE in general,
 * `gate` null for everyone in the pool and naming the bar for everyone
 * else". Re-deriving the gates here would give the board a second opinion
 * about who can work, and the engine's is the one that actually invites.
 *
 * It is a per-section call rather than one query because the gates are
 * per-section: booked-elsewhere and the hours limit both depend on THIS
 * shift's window.
 */
const NOT_CONFIGURED =
  'This environment has no Supabase project, so the event board cannot be read. See docs/04-setup-github-vercel-supabase.md.';

const EMPTY: Omit<BoardData, 'problem'> = {
  event: null,
  sections: [],
  roster: [],
  candidates: {},
  people: {},
};

interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, string>,
  ): PromiseLike<{ data: CandidateRow[] | null; error: { message: string } | null }>;
}

export async function loadBoard(id: string): Promise<BoardData> {
  if (!supabaseConfigured()) return { ...EMPTY, problem: NOT_CONFIGURED };

  const supabase = createClient(await cookies());

  const [event, sections, roster] = await Promise.all([
    supabase.from('event_board_v').select('*').eq('id', id).maybeSingle<BoardEvent>(),
    supabase
      .from('event_board_sections_v')
      .select('*')
      .eq('event_id', id)
      // §3.3: "the sections are ordered by start time, earliest first, so
      // the board reads like the running order of the day."
      .order('starts_at')
      .returns<BoardSection[]>(),
    supabase
      .from('event_board_roster_v')
      .select('*')
      .eq('event_id', id)
      .order('display_name')
      .returns<RosterRow[]>(),
  ]);

  const error = event.error ?? sections.error ?? roster.error;
  if (error) return { ...EMPTY, problem: error.message };
  if (!event.data) return { ...EMPTY, problem: null };

  const sectionRows = sections.data ?? [];
  const rpc = supabase as unknown as RpcClient;

  const pools = await Promise.all(
    sectionRows.map((section) => rpc.rpc('auto_assign_candidates', { p_shift: section.id })),
  );

  const candidates: Record<string, CandidateRow[]> = {};
  const wanted = new Set<string>();
  sectionRows.forEach((section, index) => {
    const rows = pools[index]?.data ?? [];
    candidates[section.id] = rows;
    for (const row of rows) {
      // wrong_role never reaches the screen (§6), so its worker is never
      // named either — that is most of the directory on a busy event.
      if (row.gate !== 'wrong_role') wanted.add(row.staff_id);
    }
  });

  const people: Record<string, PoolPerson> = {};
  if (wanted.size > 0) {
    const { data } = await supabase
      .from('staff_directory_v')
      .select('id, display_name, employee_id, rating, reliability')
      .in('id', [...wanted])
      .returns<(PoolPerson & { id: string })[]>();
    for (const person of data ?? []) {
      people[person.id] = {
        staff_id: person.id,
        display_name: person.display_name,
        employee_id: person.employee_id,
        rating: person.rating,
        reliability: person.reliability,
      };
    }
  }

  return {
    event: event.data,
    sections: sectionRows,
    roster: roster.data ?? [],
    candidates,
    people,
    problem: null,
  };
}
