'use client';

import { UK_ZONE, displayTime, formatDateIn } from '@thc/domain';
import { Pill } from '@thc/ui';
import { useViewerZone } from '../../_components/useViewerZone';
import { formatMoney, formatWorked } from './earnings';
import { formatPayDate } from './pay-date';
import type { EarningsRow } from '../types';

/**
 * One card in Earnings history — §10.1: "role · rate/h · event name · venue
 * address · date/time · the amount earned on that shift".
 *
 * Two §1.8 rules meet on this card and they are not the same rule:
 *
 *   the shift window is a SCHEDULED time, so it renders UK-first with a
 *   "your time" second line for a viewer outside the UK;
 *   the pay date is a UK calendar date, not an instant, so it has no second
 *   line to give.
 *
 * The rate is the worker's BASE rate. Holiday pay is not shown, not
 * blended, and not on the row — §9.8 breaks it out at 12.07% wherever it
 * appears, and it appears on a payslip, not here.
 */
export function EarningsCard({ row }: { row: EarningsRow }) {
  const zone = useViewerZone();
  const from = displayTime(row.startsAt, 'scheduled', zone);
  const to = displayTime(row.endsAt, 'scheduled', zone);
  const date = formatDateIn(new Date(row.startsAt), UK_ZONE, { weekday: 'short' });

  return (
    <div className="mcard">
      <div className="card-head">
        <Pill tone="green">Paid {formatPayDate(row.payDate)}</Pill>
        <span className="right earn">{formatMoney(row.basePence ?? 0)}</span>
      </div>
      <div className="t">
        {row.roleName} · £{row.payRate.toFixed(2)}/h
      </div>
      <div className="m">
        {row.eventTitle} · {row.venueName}
        {row.venueAddress ? `, ${row.venueAddress}` : ''}
      </div>
      <div className="m mono">
        {date} · {from.primary} – {to.primary}
        {row.payableMin !== null ? ` · ${formatWorked(row.payableMin)}` : ''}
        {row.floorApplied ? ' (4-hour minimum applied)' : ''}
      </div>
      {from.secondary ? (
        <div className="m mono">
          {from.secondary} – {to.secondary}
        </div>
      ) : null}
      {row.unpaidBreakMin > 0 ? (
        <div className="m">Unpaid breaks deducted: {formatWorked(row.unpaidBreakMin)}</div>
      ) : null}
    </div>
  );
}
