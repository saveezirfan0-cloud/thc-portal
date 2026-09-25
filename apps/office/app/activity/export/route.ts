import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../../staff/data';
import {
  EXPORT_CAP,
  activityCsvFailed,
  activityCsvHead,
  activityCsvRows,
  activityCsvTruncated,
  activityFileName,
} from '../csv';
import { activityExportPages } from '../data';
import { parseFilters } from '../view-model';

/**
 * GET /activity/export — the activity log as CSV, under the same filters
 * as /activity (area, person, text, period), newest first, at most
 * EXPORT_CAP rows; the file says so on its last line when it stopped
 * there (ADR-0035, §1.7).
 *
 * Two gates. The session must be an admin's — asked here, so a worker or
 * a client who reaches this URL gets a 403 rather than an empty file —
 * and `admin_activity` checks the role again in its body, as it does for
 * the screen. The first page is read before the response starts, so a
 * refusal is a status code; the rest stream, a page of 200 at a time.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!supabaseConfigured()) {
    return new Response('This environment has no Supabase project.', { status: 503 });
  }
  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return new Response('Sign in to export the activity log.', { status: 401 });
  if (auth.user.app_metadata?.['role'] !== 'admin') {
    return new Response('The activity log is for the office only.', { status: 403 });
  }

  const url = new URL(request.url);
  // `before` is where the screen had paged to, not a filter: the file
  // always starts from the newest matching entry.
  const filters = { ...parseFilters((key) => url.searchParams.get(key)), before: null };
  const pages = activityExportPages(supabase, filters, EXPORT_CAP);

  let first: Awaited<ReturnType<typeof pages.next>>;
  try {
    first = await pages.next();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const forbidden = message.includes('not_authorised');
    return new Response(forbidden ? 'The activity log is for the office only.' : message, {
      status: forbidden ? 403 : 500,
    });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(activityCsvHead()));
      if (!first.done) {
        controller.enqueue(encoder.encode(activityCsvRows(first.value.rows)));
        if (first.value.truncated) controller.enqueue(encoder.encode(activityCsvTruncated()));
      }
      if (first.done || first.value.truncated) controller.close();
    },
    async pull(controller) {
      try {
        const next = await pages.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(activityCsvRows(next.value.rows)));
        if (next.value.truncated) {
          controller.enqueue(encoder.encode(activityCsvTruncated()));
          controller.close();
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(activityCsvFailed(error instanceof Error ? error.message : String(error))),
        );
        controller.close();
      }
    },
    async cancel() {
      await pages.return();
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${activityFileName(filters)}"`,
      'cache-control': 'no-store',
    },
  });
}
