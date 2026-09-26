'use server';

import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../../staff/data';
import { HISTORY_PAGE, type HistoryRow, isHistoryEntity, isUuid, nextBefore } from './model';

export interface HistoryPage {
  rows: HistoryRow[];
  nextBefore: number | null;
  problem: string | null;
}

/**
 * One page of a record's history (20260930210300 `admin_record_history`).
 *
 * A read, as the signed-in manager: the function checks the role in its
 * own body, so a worker or a client who called this action would be
 * refused by the database, not by anything here. The arguments are
 * checked only so a malformed call is a message rather than a SQL error.
 */
export async function loadRecordHistory(
  entity: string,
  id: string,
  before: number | null = null,
): Promise<HistoryPage> {
  if (!isHistoryEntity(entity) || !isUuid(id)) {
    return { rows: [], nextBefore: null, problem: 'This record has no history to show.' };
  }
  if (!supabaseConfigured()) {
    return {
      rows: [],
      nextBefore: null,
      problem: 'This environment has no Supabase project, so there is no history to show.',
    };
  }
  const cursor =
    typeof before === 'number' && Number.isSafeInteger(before) && before > 0 ? before : null;
  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const { data, error } = await supabase.rpc('admin_record_history', {
    p_entity: entity,
    p_id: id,
    p_limit: HISTORY_PAGE,
    p_before: cursor,
  });
  if (error) {
    return {
      rows: [],
      nextBefore: null,
      problem: error.message.includes('not_authorised')
        ? 'Only the office can read the history.'
        : 'The history could not be read. Try again.',
    };
  }
  const rows = (data ?? []) as HistoryRow[];
  return { rows, nextBefore: nextBefore(rows, HISTORY_PAGE), problem: null };
}
