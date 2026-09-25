import type { ReactNode } from 'react';
import { capMeter } from '@thc/domain';
import { meterFill } from './model';

/**
 * The RULE-20 week meter — wireframes/staff/radar.html.
 *
 * On the list: "This week (Mon 14 – Sun 20) · 8 h of 20 h" with the roles
 * line above it. On the detail: "Week of Mon 14 with this shift · 13 h of
 * 20 h", green while the shift fits and coral once it does not — and then
 * the bar is the explanation, not a second copy of it.
 *
 * A worker with no ceiling still gets the strip: their booked hours and
 * "no weekly limit", so the absence of a cap is said rather than implied
 * by a missing block.
 */
export function WeekMeter({
  label,
  bookedHours,
  capHours,
  shiftHours = 0,
  above,
  below,
}: {
  label: ReactNode;
  bookedHours: number;
  capHours: number | null;
  /** Added to the bar on the detail: "with this shift". */
  shiftHours?: number;
  /** The roles line, on the list strip. */
  above?: ReactNode;
  /** The explanation under a coral bar. */
  below?: ReactNode;
}) {
  const fill = meterFill(bookedHours, capHours, shiftHours);
  const figure =
    capMeter({ weekStart: null, bookedHours: fill.total, capHours, shiftHours: 0 }) ??
    `${fill.total} h · no weekly limit`;
  const tone = fill.over ? 'coral' : shiftHours > 0 ? 'green' : undefined;

  return (
    <div className={`meter${fill.over ? ' over' : ''}`}>
      {above ? <div className="row">{above}</div> : null}
      <div className="row">
        <span>{label}</span>
        <span className={`right mono${tone ? ` ${tone}` : ''}`}>{figure}</span>
      </div>
      {capHours !== null ? (
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={fill.total}
          aria-valuemin={0}
          aria-valuemax={capHours}
        >
          <div className={`fill${tone ? ` ${tone}` : ''}`} style={{ width: `${fill.percent}%` }} />
        </div>
      ) : null}
      {below ? <div className="xs muted">{below}</div> : null}
    </div>
  );
}
