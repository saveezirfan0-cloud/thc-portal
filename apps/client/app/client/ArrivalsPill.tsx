import { Pill } from '@thc/ui';
import type { ArrivalCount, EventArrivals } from './arrivals';

/**
 * "11 of 13 arrived" — on-the-day arrival COUNTS for the customer (ADR-0053).
 *
 * A green-dot Pill, the same `dot` pattern the list uses for "Ongoing". It
 * shows two numbers and nothing else: no names, no times, no Late / No-show
 * per person, no location. The denominator is the confirmed line-up (the
 * same N as "N of M confirmed"), never the headcount and never the buffer.
 *
 * Renders nothing when there is nothing to count: no row from
 * `client_arrivals_v` (the event has not started, or was cancelled), or a
 * confirmed count of 0.
 *
 * Presentational only, with a type-only import from the loader, so it can be
 * dropped into the `'use client'` list and event screens as one line.
 *
 *   whole event   <Arrivals counts={arrivals[e.id]} />
 *   one role      <Arrivals counts={arrivals} shiftIds={ids} startsAt={group.startsAt} now={now} />
 */
export interface ArrivalsProps {
  /** This event's entry from `loadArrivals()`; undefined when the view had no row. */
  counts?: EventArrivals | null;
  /**
   * Per-role variant: only these role sections (`shift_id`s) are counted —
   * a role can have more than one section. Omitted, the whole event.
   */
  shiftIds?: readonly string[];
  /**
   * Per-role variant: the role section's own start (RULE-18). With `now`,
   * nothing is shown before it, so a later role does not read "0 of 4
   * arrived" while its window has not opened yet.
   */
  startsAt?: string;
  now?: string | Date;
  large?: boolean;
  className?: string;
}

/** The figure to show: the event total, or the sum of the named sections. */
export function arrivalsFor(
  counts: EventArrivals | null | undefined,
  shiftIds?: readonly string[],
): ArrivalCount | null {
  if (!counts) return null;
  if (!shiftIds) return { confirmed: counts.confirmed, arrived: counts.arrived };
  let confirmed = 0;
  let arrived = 0;
  let found = false;
  for (const id of new Set(shiftIds)) {
    const s = counts.bySection[id];
    if (!s) continue;
    found = true;
    confirmed += s.confirmed;
    arrived += s.arrived;
  }
  return found ? { confirmed, arrived } : null;
}

export function arrivalsLabel({ arrived, confirmed }: ArrivalCount): string {
  return `${arrived} of ${confirmed} arrived`;
}

export function Arrivals({ counts, shiftIds, startsAt, now, large, className }: ArrivalsProps) {
  const figure = arrivalsFor(counts, shiftIds);
  if (!figure || figure.confirmed <= 0) return null;

  if (startsAt && now !== undefined) {
    const at = now instanceof Date ? now.getTime() : Date.parse(now);
    const start = Date.parse(startsAt);
    if (Number.isFinite(at) && Number.isFinite(start) && at < start) return null;
  }

  return (
    <Pill
      tone="green"
      dot
      large={large}
      className={className ? `arrivals ${className}` : 'arrivals'}
      title="Checked in so far, out of the confirmed line-up"
    >
      {arrivalsLabel(figure)}
    </Pill>
  );
}
