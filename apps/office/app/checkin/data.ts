import { acceptedLog } from '@thc/domain';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { signPhotos } from './photos';
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
  violations: ViolationRow[];
  problem: string | null;
}

/** Today in UK terms — the monitor is the screen for the day of the event (§9.5, §1.8). */
function ukDayBounds(now = new Date()): { from: string; to: string } {
  const uk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const offset = now.getTime() - uk.getTime();
  const start = new Date(uk);
  start.setHours(0, 0, 0, 0);
  // A shift that began yesterday evening and ends at 03:00 is still today's
  // problem, so the window reaches back far enough to keep it on the board.
  return {
    from: new Date(start.getTime() + offset - 12 * 3600_000).toISOString(),
    to: new Date(start.getTime() + offset + 36 * 3600_000).toISOString(),
  };
}

export async function loadMonitor(): Promise<MonitorPageData> {
  if (!supabaseConfigured()) {
    return {
      rows: [],
      violations: [],
      problem:
        'This environment has no Supabase project, so the live monitor cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = createClient(await cookies());
  const { from, to } = ukDayBounds();

  const [monitor, violations] = await Promise.all([
    supabase
      .from('checkin_monitor_v')
      .select('*')
      .gte('starts_at', from)
      .lte('starts_at', to)
      .order('starts_at', { ascending: true }),
    supabase
      .from('violations')
      .select(
        `id, booking_id, type, detected_at, minutes_late, resolved, resolved_at,
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
         )`,
      )
      .order('detected_at', { ascending: false })
      .limit(100),
  ]);

  if (monitor.error) {
    return { rows: [], violations: [], problem: monitor.error.message };
  }

  // Same placeholder-types caveat as the RPC above: `checkin_monitor_v` is
  // not in the generated `Database`, so the row shape is asserted here and
  // has to match 20260922090000_ping_ingest_and_monitor.sql.
  const monitorRows = (monitor.data ?? []) as unknown as Record<string, unknown>[];

  // §9.5 "the real selfie": every photo_path on the board is signed once,
  // through this manager's session (photos.ts), and only the URL reaches a
  // row. A removed worker's path is already NULL in the view and in the
  // violation mapping below, so nothing of theirs is signed.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const photos = await signPhotos(supabase, [
    ...monitorRows.map((r) => r.photo_path as string | null),
    ...(violations.data ?? []).map((v: any) => (v.staff?.removed_at ? null : v.staff?.photo_path)),
  ]);
  const urlFor = (path: unknown): string | null =>
    typeof path === 'string' ? (photos.get(path) ?? null) : null;

  const rows: MonitorRow[] = monitorRows.map((r) => ({
    bookingId: r.booking_id as string,
    staffId: r.staff_id as string,
    eventId: r.event_id as string,
    eventTitle: (r.event_title as string) ?? '',
    roleName: (r.role_name as string) ?? '',
    // The view spells the §1.7 label with `||`, which is NULL for a removed
    // worker who never got an Employee ID; deleted_account_label() prints
    // "#unknown" for that case and so does this.
    staffName: (r.staff_name as string | null) ?? deletedAccountLabel(null),
    photoUrl: urlFor(r.photo_path),
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

  const violationRows: ViolationRow[] = (violations.data ?? []).map((v: any) => {
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
        ? deletedAccountLabel(staff.employee_id)
        : `${staff?.first_name ?? ''} ${staff?.last_name ?? ''}`.trim(),
      photoUrl: staff?.removed_at ? null : urlFor(staff?.photo_path),
      eventTitle: shift?.event?.title ?? '',
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

  return { rows, violations: violationRows, problem: null };
}

/**
 * §1.7's label, as `deleted_account_label()` spells it in SQL
 * (20260921190118_gdpr_removal.sql): the Employee ID is the number, and a
 * worker removed before one was issued reads "#unknown" — never "#null".
 */
export function deletedAccountLabel(employeeId: number | string | null | undefined): string {
  return `Deleted account #${employeeId ?? 'unknown'}`;
}
