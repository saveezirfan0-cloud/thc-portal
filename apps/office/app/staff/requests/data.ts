import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { signStaffPhotos } from '../../_lib/photos';
import { supabaseConfigured } from '../data';
import type { ChangeRequestRow, ChangeRequestView } from './types';

/**
 * Reads for the change-request queue (/staff/requests) and the /staff/:id
 * banner — ADR-0038.
 *
 * Through `office_profile_change_requests()` rather than the table, for one
 * reason: the Decided tab names the manager who decided, and an admin can
 * read only their own `profiles` row. The function is a definer with the
 * admin check in its own body (20260930130000), so a session that is not
 * the office's is refused, not shown an empty queue.
 *
 * Both photos are keys in the private `photos` bucket; they are signed here
 * through the manager's own session (`_lib/photos.ts`), short-lived.
 */

/** Typed by hand until `gen:types` runs against the live project (docs/18 §8). */
interface QueueRpc {
  rpc(
    fn: 'office_profile_change_requests',
    args: { p_staff: string | null; p_decided: boolean; p_limit: number },
  ): PromiseLike<{ data: ChangeRequestRow[] | null; error: { message: string } | null }>;
}

/** HEAD count on the table: admin_read answers it, nobody else counts anything. */
interface CountClient {
  from(table: 'profile_change_requests'): {
    select(
      columns: string,
      options: { count: 'exact'; head: true },
    ): {
      eq(
        column: 'status',
        value: 'pending',
      ): PromiseLike<{ count: number | null; error: { message: string } | null }>;
    };
  };
}

export type SessionClient = ReturnType<typeof createClient>;

export async function readChangeRequests(
  supabase: SessionClient,
  options: { staffId?: string; decided?: boolean; limit?: number } = {},
): Promise<{ rows: ChangeRequestView[]; problem: string | null }> {
  const { data, error } = await (supabase as unknown as QueueRpc).rpc(
    'office_profile_change_requests',
    {
      p_staff: options.staffId ?? null,
      p_decided: options.decided ?? false,
      p_limit: options.limit ?? 200,
    },
  );
  if (error) return { rows: [], problem: error.message };

  const rows = data ?? [];
  const urls = await signStaffPhotos(
    rows.flatMap((row) => [row.current_photo_path, row.proposed_photo_path]),
  );
  const url = (path: string | null) => (path ? (urls.get(path) ?? null) : null);
  return {
    rows: rows.map((row) => ({
      ...row,
      current_photo_url: url(row.current_photo_path),
      proposed_photo_url: url(row.proposed_photo_path),
    })),
    problem: null,
  };
}

/** "Change requests (N)" on /staff and the sidebar. Any failure is "no count". */
export async function countPendingChangeRequests(supabase: SessionClient): Promise<number> {
  try {
    const { count, error } = await (supabase as unknown as CountClient)
      .from('profile_change_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    return error || !count ? 0 : count;
  } catch {
    return 0;
  }
}

export interface RequestsPageData {
  pending: ChangeRequestView[];
  decided: ChangeRequestView[];
  problem: string | null;
}

export async function loadRequestsPage(): Promise<RequestsPageData> {
  if (!supabaseConfigured()) {
    return {
      pending: [],
      decided: [],
      problem:
        'This environment has no Supabase project, so the change requests cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }
  const supabase = createClient(await cookies());
  const [pending, decided] = await Promise.all([
    readChangeRequests(supabase, { decided: false }),
    readChangeRequests(supabase, { decided: true, limit: 200 }),
  ]);
  return {
    pending: pending.rows,
    decided: decided.rows,
    problem: pending.problem ?? decided.problem,
  };
}
