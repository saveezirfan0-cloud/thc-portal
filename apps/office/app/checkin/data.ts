import { acceptedLog } from '@thc/domain';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
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

  const rows: MonitorRow[] = monitorRows.map((r) => ({
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

  /* eslint-disable @typescript-eslint/no-explicit-any */
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
        ? `Deleted account #${staff.employee_id}`
        : `${staff?.first_name ?? ''} ${staff?.last_name ?? ''}`.trim(),
      photoPath: staff?.removed_at ? null : (staff?.photo_path ?? null),
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
