/**
 * "Short-staffed — next 48 hours" on /dashboard.
 *
 * Which role sections are short is decided in SQL, once:
 * `dashboard_short_staffed_v` (20261001200400) returns every ROLE SECTION
 * (not event) that starts in the next 48 hours with confirmed below its
 * headcount, cancelled events excluded. This file only shapes those rows
 * for the panel and orders them. It deliberately does not re-filter: a
 * second copy of "short" here would be the first one to drift.
 *
 * No money in any of it — the view carries none, and neither does this
 * shape.
 */

/** What the database returns. Must match 20261001200400_dashboard_short_staffed.sql. */
export interface ShortStaffedRow {
  shift_id: string;
  event_id: string;
  event_title: string;
  event_date: string;
  client_name: string;
  venue_name: string;
  role_name: string;
  starts_at: string;
  ends_at: string;
  headcount: number;
  confirmed: number;
  open_positions: number;
}

/** One line on the panel. */
export interface ShortStaffedRole {
  shiftId: string;
  eventId: string;
  eventTitle: string;
  clientName: string;
  venueName: string;
  roleName: string;
  /** The ROLE section's own start, never the event's (RULE-18). */
  startsAt: string;
  endsAt: string;
  headcount: number;
  /** Confirmed only — an invitation or a Radar application is not fill. */
  confirmed: number;
  open: number;
}

export function toShortStaffed(rows: ShortStaffedRow[]): ShortStaffedRole[] {
  return rows
    .map((row) => ({
      shiftId: row.shift_id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      clientName: row.client_name,
      venueName: row.venue_name,
      roleName: row.role_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      headcount: row.headcount,
      confirmed: row.confirmed,
      open: row.open_positions,
    }))
    .sort(byStart);
}

/**
 * Soonest first — the one a manager has least time to fix. Ties (two roles
 * of one event starting together) fall back to event, then role, so the
 * order is stable from one page load to the next.
 */
export function byStart(a: ShortStaffedRole, b: ShortStaffedRole): number {
  const diff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
  if (diff !== 0) return diff;
  return (
    a.eventTitle.localeCompare(b.eventTitle, 'en-GB') ||
    a.roleName.localeCompare(b.roleName, 'en-GB') ||
    a.shiftId.localeCompare(b.shiftId)
  );
}

/** "3 of 5" — confirmed against HEADCOUNT; the buffer is never in it (§3.2). */
export function confirmedOf(role: Pick<ShortStaffedRole, 'confirmed' | 'headcount'>): string {
  return `${role.confirmed} of ${role.headcount}`;
}

/** "2 open". */
export function openLabel(open: number): string {
  return `${open} open`;
}

/** Positions still to fill across the panel. */
export function totalOpen(roles: ShortStaffedRole[]): number {
  return roles.reduce((sum, role) => sum + role.open, 0);
}

/** The panel header's count: "3 roles · 7 open", or "All filled". */
export function shortStaffedSummary(roles: ShortStaffedRole[]): string {
  if (roles.length === 0) return 'All filled';
  const n = roles.length;
  return `${n} ${n === 1 ? 'role' : 'roles'} · ${openLabel(totalOpen(roles))}`;
}
