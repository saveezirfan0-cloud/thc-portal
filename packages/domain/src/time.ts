/**
 * Time-zone display rules — Scope §1.8.
 *
 * Everything is stored as `timestamptz`. Every rule in the platform is
 * evaluated in Europe/London. What differs is the *display*:
 *
 *  - Scheduled times (shift start/end, deadlines) show UK time, plus a second
 *    line in the viewer's zone when that zone is not Europe/London.
 *  - Actual stamps (check-in, check-out) show viewer-local only — the worker
 *    wants to know what their own clock said.
 *  - Manager-typed time inputs are labelled "(UK time)".
 *  - Audit stamps (contract signature, verification) are UK-only, never dual.
 */

export const UK_ZONE = 'Europe/London';

export type TimeDisplayKind = 'scheduled' | 'actual' | 'audit';

export function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || UK_ZONE;
}

/** True when the viewer needs the second "your time" line. */
export function needsDualZone(zone: string = viewerZone()): boolean {
  return zone !== UK_ZONE;
}

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
const DATE_TIME_OPTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

export function formatTimeIn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { ...TIME_OPTS, timeZone: zone }).format(instant);
}

export function formatDateTimeIn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { ...DATE_TIME_OPTS, timeZone: zone }).format(instant);
}

/** The short zone name shown next to a dual-zone second line, e.g. "CEST". */
export function zoneLabel(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    timeZoneName: 'short',
  }).formatToParts(instant);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? zone;
}

export interface DisplayedTime {
  /** The line every viewer sees. */
  primary: string;
  /** The "your time" line, present only for scheduled times in a non-UK zone. */
  secondary?: string;
}

/**
 * Renders one instant according to §1.8, given what kind of time it is.
 * `withDate` switches from "18:00" to "14 Jun, 18:00".
 */
export function displayTime(
  instant: Date,
  kind: TimeDisplayKind,
  zone: string = viewerZone(),
  withDate = false,
): DisplayedTime {
  const fmt = withDate ? formatDateTimeIn : formatTimeIn;

  if (kind === 'actual') {
    // The worker's own clock. Never dual.
    return { primary: fmt(instant, zone) };
  }

  if (kind === 'audit') {
    // Signature and verification stamps are UK-only, always.
    return { primary: `${fmt(instant, UK_ZONE)} (UK)` };
  }

  const primary = fmt(instant, UK_ZONE);
  if (!needsDualZone(zone)) return { primary };
  return { primary: `${primary} (UK)`, secondary: `${fmt(instant, zone)} your time` };
}

/** The label a manager-typed time input must carry (§1.8). */
export const UK_INPUT_SUFFIX = '(UK time)';

export function ukInputLabel(label: string): string {
  return `${label} ${UK_INPUT_SUFFIX}`;
}
