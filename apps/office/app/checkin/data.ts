import { acceptedLog } from '@thc/domain';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { signStaffPhotos } from '../_lib/photos';
import { type LogQuery, VIOLATION_PAGE_SIZE, flaggedAs, pageRange, ukDayBounds } from './log';
import type { MonitorRow, MonitorStatus, ViolationRow, ViolationType } from './types';

/**
 * Reads for /checkin (§9.5).
 *
 * The Status column is resolved by `checkin_monitor_v`, not here: seven
 * states with time arithmetic in each are exactly the thing that drifts
 * when a screen re-derives them, and pgTAP can hold the view.
 */

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface MonitorPageData {
  rows: MonitorRow[];
  /** One page of the violation log, filtered in the query (audit D50). */
  violations: ViolationRow[];
  /** Every unresolved violation, not just this page's. */
  unresolvedCount: number;
  /** There is an older page. */
  hasMore: boolean;
  problem: string | null;
}

/** The session client, as `createClient` returns it. */
type SessionClient = ReturnType<typeof createClient>;

const VIOLATION_COLUMNS = `id, booking_id, type, detected_at, minutes_late, resolved, resolved_at,
  resolution_note, actual_finish_at,
  staff:staff_id ( first_name, last_name, photo_path, removed_at, employee_id ),
  resolver:resolved_by ( full_name ),
  booking:booking_id (
    shift:shift_id (
      starts_at, ends_at,
      role:role_id ( name ),
      event:event_id ( title, venue_name, payroll_exported_at )
    ),
    logs:check_logs ( check_in_at, check_out_at, manager_finish_at )
  )`;

/** A violation row before its photo path is turned into a URL. */
type UnsignedViolation = Omit<ViolationRow, 'photoUrl'> & { photoPath: string | null };

/**
 * The violation log's read (§9.5), shared with the Shifts tab on
 * /staff/:id: §9.6 says the profile's log and this one are "deliberately
 * identical in behaviour", so both surfaces open the same detail window with
 * the same fields, read by the same query. `staffId` scopes it to one
 * person (all of theirs, newest first).
 *
 * The monitor's log is filtered and paged IN THE QUERY (audit D50): it used
 * to fetch the newest 100 rows of every kind and hide the resolved ones in
 * the browser, so an old unresolved No check-out — the one that holds a
 * worker's pay — could fall off the end of the list. "Show resolved"
 * unticked asks for `resolved = false` only; ticked, it asks for both.
 */
async function queryViolations(
  supabase: SessionClient,
  scope: { staffId?: string; log?: LogQuery } = {},
): Promise<{ rows: UnsignedViolation[]; hasMore: boolean; error: string | null }> {
  let query = supabase.from('violations').select(VIOLATION_COLUMNS);
  if (scope.staffId) query = query.eq('staff_id', scope.staffId);
  if (scope.log && !scope.log.showResolved) query = query.eq('resolved', false);
  query = query.order('detected_at', { ascending: false }).order('id', { ascending: false });
  const range = scope.log ? pageRange(scope.log.page) : null;
  const result = await (range ? query.range(range.from, range.to) : query.limit(500));
  if (result.error) return { rows: [], hasMore: false, error: result.error.message };
  const data = (result.data ?? []) as unknown[];
  const hasMore = range !== null && data.length > VIOLATION_PAGE_SIZE;
  const page = hasMore ? data.slice(0, VIOLATION_PAGE_SIZE) : data;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (page as any[]).map((v: any): UnsignedViolation => {
    const shift = v.booking?.shift;
    // `acceptedLog`, not `[0]` (§1.5). check_logs holds one row per button
    // press: a RULE-15 turn-away and an out-of-radius refusal are logged
    // too, and only the accepted press carries check_in_at. An embedded
    // array has no ordering guarantee, so `[0]` could hand this window the
    // turned-away attempt — blank or wrong times, immediately beside the
    // "Actual finish (UK time)" field a manager types into to resolve.
    // The monitor table above is already safe: it reads checkin_monitor_v,
    // which resolves the row in SQL.
    //
    // Narrowed in TypeScript rather than in the query, unlike the worker's
    // on-shift loader: there `logs` is embedded one level down and takes a
    // `referencedTable` filter cleanly, whereas here it hangs off `booking`
    // and the nested form is not something this repo can exercise without a
    // live PostgREST. The guard is what makes the screen correct either
    // way, so the untested modifier buys nothing.
    const log = acceptedLog<{
      check_in_at: string | null;
      check_out_at: string | null;
      manager_finish_at: string | null;
    }>(v.booking?.logs);
    const staff = v.staff;
    return {
      id: v.id,
      bookingId: v.booking_id,
      staffName: staff?.removed_at
        ? `Deleted account #${staff.employee_id}`
        : `${staff?.first_name ?? ''} ${staff?.last_name ?? ''}`.trim(),
      photoPath: staff?.removed_at ? null : (staff?.photo_path ?? null),
      eventTitle: shift?.event?.title ?? '',
      // §9.5: the server composes the window's "Flagged as" line.
      flaggedAs: flaggedAs(v.type as ViolationType, shift?.event?.title ?? ''),
      venueName: shift?.event?.venue_name ?? '',
      roleName: shift?.role?.name ?? '',
      startsAt: shift?.starts_at ?? '',
      endsAt: shift?.ends_at ?? '',
      type: v.type as ViolationType,
      detectedAt: v.detected_at,
      minutesLate: v.minutes_late ?? null,
      resolved: Boolean(v.resolved),
      resolvedAt: v.resolved_at ?? null,
      resolvedByName: v.resolver?.full_name ?? null,
      resolutionNote: v.resolution_note ?? null,
      actualFinishAt: v.actual_finish_at ?? null,
      checkInAt: log?.check_in_at ?? null,
      checkOutAt: log?.manager_finish_at ?? log?.check_out_at ?? null,
      payrollExported: Boolean(shift?.event?.payroll_exported_at),
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { rows, hasMore, error: null };
}

/** Swap each row's storage path for its signed URL (or null → initials). */
function withUrls<T extends { photoPath: string | null }>(
  rows: readonly T[],
  urls: ReadonlyMap<string, string>,
): (Omit<T, 'photoPath'> & { photoUrl: string | null })[] {
  return rows.map(({ photoPath, ...rest }) => ({
    ...rest,
    photoUrl: photoPath ? (urls.get(photoPath) ?? null) : null,
  }));
}

/**
 * One worker's violation log in the monitor's own shape, for the Shifts tab
 * on /staff/:id, which opens the same `ResolveModal` (§9.6). The log there
 * draws no avatars — the profile header already shows the face — so nothing
 * is signed.
 */
export async function loadStaffViolationLog(
  supabase: SessionClient,
  staffId: string,
): Promise<{ rows: ViolationRow[]; error: string | null }> {
  const { rows, error } = await queryViolations(supabase, { staffId });
  if (error) return { rows: [], error };
  return { rows: withUrls(rows, new Map()), error: null };
}

export async function loadMonitor(
  log: LogQuery = { showResolved: false, page: 1 },
): Promise<MonitorPageData> {
  if (!supabaseConfigured()) {
    return {
      rows: [],
      violations: [],
      unresolvedCount: 0,
      hasMore: false,
      problem:
        'This environment has no Supabase project, so the live monitor cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = createClient(await cookies());
  const { from, to } = ukDayBounds();

  const [monitor, violations, unresolved] = await Promise.all([
    // Every role section that overlaps today's UK day: today's, and last
    // night's still running past midnight (log.ts).
    supabase
      .from('checkin_monitor_v')
      .select('*')
      .lt('starts_at', to)
      .gt('ends_at', from)
      .order('starts_at', { ascending: true }),
    queryViolations(supabase, { log }),
    supabase.from('violations').select('id', { count: 'exact', head: true }).eq('resolved', false),
  ]);

  if (monitor.error) {
    return {
      rows: [],
      violations: [],
      unresolvedCount: 0,
      hasMore: false,
      problem: monitor.error.message,
    };
  }

  // Same placeholder-types caveat as the RPC above: `checkin_monitor_v` is
  // not in the generated `Database`, so the row shape is asserted here and
  // has to match 20260927160600_monitor_reads_no_checkout_and_the_uk_day.sql.
  const monitorRows = (monitor.data ?? []) as unknown as Record<string, unknown>[];

  const unsigned = monitorRows.map((r) => ({
    bookingId: r.booking_id as string,
    staffId: r.staff_id as string,
    eventId: r.event_id as string,
    eventTitle: (r.event_title as string) ?? '',
    roleName: (r.role_name as string) ?? '',
    staffName: (r.staff_name as string) ?? '',
    photoPath: (r.photo_path as string | null) ?? null,
    startsAt: r.starts_at as string,
    endsAt: r.ends_at as string,
    checkInAt: (r.check_in_at as string | null) ?? null,
    checkOutAt: (r.check_out_at as string | null) ?? null,
    lastFixInside: (r.last_fix_inside as boolean | null) ?? null,
    lastFixAt: (r.last_fix_at as string | null) ?? null,
    breaksCount: (r.breaks_count as number | null) ?? null,
    lastBreakAt: (r.last_break_at as string | null) ?? null,
    lateCheckOut: Boolean(r.late_check_out),
    status: r.status as MonitorStatus,
  }));

  // `photo_path` is a key in the private `photos` bucket, not a URL — the
  // browser cannot fetch it. Both tables' paths are signed in one batch.
  const urls = await signStaffPhotos([
    ...unsigned.map((r) => r.photoPath),
    ...violations.rows.map((v) => v.photoPath),
  ]);

  const rows: MonitorRow[] = withUrls(unsigned, urls);
  const violationRows: ViolationRow[] = withUrls(violations.rows, urls);

  // A failed violation read no longer passes silently as "No violations
  // logged": the board still renders, with the reason above it.
  return {
    rows,
    violations: violationRows,
    unresolvedCount:
      unresolved.error || unresolved.count === null
        ? violationRows.filter((v) => !v.resolved).length
        : unresolved.count,
    hasMore: violations.hasMore,
    problem: violations.error ?? unresolved.error?.message ?? null,
  };
}
