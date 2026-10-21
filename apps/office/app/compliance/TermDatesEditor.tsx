'use client';

import { Button, Note, UkDateField } from '@thc/ui';
import {
  LETTER_RENEWAL_LINE,
  NO_HOLIDAYS_TICK,
  blankPeriod,
  letterExpiry,
  periodSource,
  replacesPreviousLine,
  termPeriodsProblem,
} from './termDates';
import type { TermPeriod } from './termDates';
import './term-dates.css';

/**
 * The holiday periods on a University Term Dates Letter, as the reviewer
 * confirms them (ADR-0178): every period the AI read, pre-filled, with its
 * source; "+ Add period" for one it missed; remove for a wrong one. One
 * component for the candidate screen, the Needs review dialog and the
 * /staff/:id Documents tab, so the three cannot disagree on what a letter
 * with no holidays means or when it expires.
 *
 * Controlled: the caller holds the rows and the "no holidays" tick, because
 * its own Verify button is what they gate (`termLetterVerifyProblem`).
 */
export function TermDatesEditor({
  periods,
  onChange,
  editable,
  badge,
  noHolidaysConfirmed,
  onNoHolidaysConfirmed,
  uploadedAt,
  today,
  previous,
}: {
  periods: TermPeriod[];
  onChange: (next: TermPeriod[]) => void;
  editable: boolean;
  /** The AI's confidence badge for the letter (aiBadge); null when it gave none. */
  badge: { tone: string; label: string } | null;
  noHolidaysConfirmed: boolean;
  onNoHolidaysConfirmed: (confirmed: boolean) => void;
  /** When the letter was uploaded — the calendar-year fallback counts from it. */
  uploadedAt: string;
  /** The UK day, `YYYY-MM-DD`. */
  today: string;
  /** The worker's holiday ranges on file now, from their previous letter. */
  previous?: readonly string[] | null;
}) {
  const problem = termPeriodsProblem(periods);
  const expiry = letterExpiry(periods, uploadedAt, today);
  const replaces = editable ? replacesPreviousLine(previous, periods) : null;
  const update = (key: string, patch: Partial<TermPeriod>) =>
    onChange(periods.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  return (
    <div className="term-dates stack">
      {periods.length === 0 ? (
        <div className="muted sm">No holiday periods — add any the letter shows.</div>
      ) : (
        <div className="term-periods" role="group" aria-label="Holiday periods">
          <div className="term-period head" aria-hidden="true">
            <span className="label">#</span>
            <span className="label">Period</span>
            <span className="label">From</span>
            <span />
            <span className="label">To</span>
            <span className="label">Source</span>
            <span />
          </div>
          {periods.map((period, index) => {
            const source = periodSource(period);
            return (
              <div className="term-period" key={period.key}>
                <span className="mono muted">{index + 1}</span>
                <span>Holiday {index + 1}</span>
                {/* dd/mm/yyyy whatever the device's locale (ADR-0140). */}
                <UkDateField
                  label={`Period ${index + 1} from`}
                  labelHidden
                  value={period.from}
                  disabled={!editable}
                  onChange={(from) => update(period.key, { from })}
                />
                <span className="muted" aria-hidden="true">
                  →
                </span>
                <UkDateField
                  label={`Period ${index + 1} to`}
                  labelHidden
                  value={period.to}
                  disabled={!editable}
                  onChange={(to) => update(period.key, { to })}
                />
                {source === 'ai' ? (
                  <span className={`term-source ${badge?.tone ?? ''}`}>
                    {badge?.label ?? 'from the letter'}
                  </span>
                ) : (
                  <span className="term-source hand">
                    {source === 'edited' ? 'edited by hand' : 'added by hand'}
                  </span>
                )}
                {editable ? (
                  <button
                    type="button"
                    className="term-rm"
                    aria-label={`Remove period ${index + 1}`}
                    onClick={() => onChange(periods.filter((p) => p.key !== period.key))}
                  >
                    remove
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
      )}
      {editable ? (
        <div className="row wrap">
          <Button size="sm" onClick={() => onChange([...periods, blankPeriod()])}>
            + Add period
          </Button>
          <span className="muted xs">
            for a range the AI missed (poor scan, non-standard letter) — any number of periods, zero
            to four is typical
          </span>
        </div>
      ) : null}
      {problem ? (
        <div className="coral sm" role="alert">
          {problem}
        </div>
      ) : null}
      {editable && periods.length === 0 ? (
        <label className="row sm term-none">
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
          {/* ADR-0103 stands: on that day the letter has expired and the
              worker is blocked until a new one is verified (ADR-0178). */}
          {expiry.problem ? null : <span className="muted"> {LETTER_RENEWAL_LINE}</span>}
          {expiry.problem ? (
            <div className="coral" role="alert">
              {expiry.problem}
            </div>
          ) : null}
        </div>
      )}
      {replaces ? <Note tone="amber">{replaces}</Note> : null}
    </div>
  );
}
