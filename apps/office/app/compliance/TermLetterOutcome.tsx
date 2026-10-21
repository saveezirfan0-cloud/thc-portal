'use client';

import { Note } from '@thc/ui';
import { periodsProblem } from '../onboarding/view-model';
import {
  LETTER_RENEWAL_LINE,
  NO_HOLIDAYS_TICK,
  letterExpiry,
  replacesPreviousLine,
  termPeriodsProblem,
} from './termDates';
import type { Period } from './termDates';

/**
 * What a University Term Dates Letter will do with the periods on screen
 * (ADR-0183), drawn under ADR-0178's period rows wherever they are edited —
 * the Verify dialog, "Edit holiday periods" and the candidate screen:
 *
 *   · a period over a year long (a typed year), said in words;
 *   · with no periods, the tick the office must give first;
 *   · live, when the letter will expire — the last date on it, or the
 *     calendar-year fallback — and that the worker must upload the next
 *     one by then (ADR-0103 stands);
 *   · when it replaces holiday dates on file from a previous letter.
 *
 * The caller holds the tick, because its own button is what it gates
 * (`termLetterVerifyProblem`).
 */
export function TermLetterOutcome({
  periods,
  uploadedAt,
  today,
  noHolidaysConfirmed,
  onNoHolidaysConfirmed,
  previous,
  editable = true,
}: {
  periods: readonly Period[];
  /** When the letter was uploaded — the calendar-year fallback counts from it. */
  uploadedAt: string;
  /** The UK day, `YYYY-MM-DD`. */
  today: string;
  noHolidaysConfirmed: boolean;
  onNoHolidaysConfirmed: (confirmed: boolean) => void;
  /** The holiday ranges on file from the worker's previous letter, if any. */
  previous?: readonly string[] | null;
  editable?: boolean;
}) {
  const shape = periodsProblem(periods);
  const problem = termPeriodsProblem(periods);
  const expiry = letterExpiry(periods, uploadedAt, today);
  const replaces = editable ? replacesPreviousLine(previous, periods) : null;
  return (
    <div className="stack tight">
      {/* The rows already say what is missing or backwards; this adds the rest. */}
      {problem && problem !== shape ? (
        <div className="coral sm" role="alert">
          {problem}
        </div>
      ) : null}
      {editable && periods.length === 0 ? (
        <label className="row sm">
          <input
            type="checkbox"
            checked={noHolidaysConfirmed}
            onChange={(event) => onNoHolidaysConfirmed(event.target.checked)}
          />
          <span>
            <b>{NO_HOLIDAYS_TICK}</b>
          </span>
        </label>
      ) : null}
      {problem ? null : (
        <div className="sm">
          <b>{expiry.text}</b>
          {expiry.problem ? (
            <div className="coral" role="alert">
              {expiry.problem}
            </div>
          ) : (
            <span className="muted"> {LETTER_RENEWAL_LINE}</span>
          )}
        </div>
      )}
      {replaces ? <Note tone="amber">{replaces}</Note> : null}
    </div>
  );
}
