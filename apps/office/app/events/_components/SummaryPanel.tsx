'use client';

import { Panel, Pill } from '@thc/ui';
import { type Forecast, displayTime, formatAllocationPair, formatHours } from '@thc/domain';
import type { RoleSectionWindow } from '@thc/domain';
import { useViewerZone } from './useViewerZone';

const gbp = (pence: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);

/** The label belongs on the end of a range, not in the middle of it. */
const stripZone = (line: string) => line.replace(/ \((UK)\)$| your time$/, '');

export interface SummaryPanelProps {
  /** The derived event window (RULE-18), or null before the first role. */
  window: RoleSectionWindow | null;
  validRoles: number;
  erroredRoles: number;
  headcount: number;
  buffer: number;
  forecast: Forecast;
}

/**
 * The sticky summary — Scope §3.2.
 *
 * Everything here is derived: the window from the role sections (RULE-18),
 * the headcount pair from the sections' own numbers, and the forecast from
 * headcount hours, because the buffer is cover THC carries rather than
 * something the client is charged for.
 */
export function SummaryPanel({
  window,
  validRoles,
  erroredRoles,
  headcount,
  buffer,
  forecast,
}: SummaryPanelProps) {
  const zone = useViewerZone();
  // A scheduled time shows both zones, with the local line dropped when they
  // coincide — never a bare clock the reader could take for their own (§1.8).
  const start = window ? displayTime(window.startsAt, 'scheduled', zone) : null;
  const end = window ? displayTime(window.endsAt, 'scheduled', zone) : null;

  return (
    <Panel title="Summary">
      <div className="sumrow">
        <span>Derived event window</span>
        <span className="v">
          {start && end ? (
            <>
              {stripZone(start.primary)} – {end.primary}
              {start.secondary && end.secondary ? (
                <>
                  <br />
                  {stripZone(start.secondary)} – {end.secondary}
                </>
              ) : null}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>
      <div className="sumrow">
        <span>Roles</span>
        <span className="v">
          {validRoles} valid
          {erroredRoles > 0 ? ` · ${erroredRoles} error${erroredRoles === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      <div className="sumrow">
        <span>Headcount (+buffer)</span>
        <span className="v">{formatAllocationPair(headcount, buffer)}</span>
      </div>
      <div className="sumrow">
        <span>Payable hours (forecast)</span>
        <span className="v">{formatHours(forecast.payableHours)}</span>
      </div>
      <div className="sumrow">
        <span>Charge (forecast)</span>
        <span className="v">{gbp(forecast.chargePence)}</span>
      </div>
      <div className="sumrow">
        <span>Pay incl. holiday</span>
        <span className="v">{gbp(forecast.basePayPence + forecast.holidayPence)}</span>
      </div>
      <div className="sumrow">
        <span>Margin</span>
        <span className={`v ${forecast.marginPence >= 0 ? 'green' : 'coral'}`}>
          {gbp(forecast.marginPence)} · {forecast.marginPct.toFixed(1)}%
        </span>
      </div>
    </Panel>
  );
}

export function ClientPolicies({
  paysBreaks,
  paysBuffer,
  clientName,
}: {
  paysBreaks: boolean;
  paysBuffer: boolean;
  clientName: string;
}) {
  return (
    <Panel title="Client policies" actions={<Pill>read-only</Pill>}>
      <div className="policy">
        <label className="check">
          <span className={`box ${paysBreaks ? 'on' : 'off'}`} />
          <span>
            <b>Break policy</b> — {clientName} {paysBreaks ? 'pays' : 'does not pay'} for breaks
            <br />
            <span className="muted xs">
              {paysBreaks
                ? 'Workers have no break buttons and log nothing.'
                : 'Workers get Start / Finish break buttons; break time is deducted from pay and charge.'}
            </span>
          </span>
        </label>
        <label className="check">
          <span className={`box ${paysBuffer ? 'on' : 'off'}`} />
          <span>
            <b>Buffer policy</b> — {clientName} {paysBuffer ? 'pays' : 'does not pay'} for the
            buffer
            <br />
            <span className="muted xs">
              {paysBuffer
                ? 'Everyone accepted works and is paid normally.'
                : 'Strict: past the headcount, later arrivals are turned away — a fixed 4 hours if on time, nothing if late.'}
            </span>
          </span>
        </label>
        <span className="muted xs">
          Set at client level on the client card, shown here and on the event board.
        </span>
      </div>
    </Panel>
  );
}
