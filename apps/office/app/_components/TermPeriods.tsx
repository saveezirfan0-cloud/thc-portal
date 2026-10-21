'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Note, UkDateField } from '@thc/ui';
import { type Period, parsePeriod, periodsProblem } from '../onboarding/view-model';
import { setTermLetterPeriods } from '../compliance/actions';
import { TermLetterOutcome } from '../compliance/TermLetterOutcome';
import { termLetterVerifyProblem } from '../compliance/termDates';
import { ukDay } from '../compliance/queue';
import './term-periods.css';

/**
 * A University Term Dates Letter's holiday periods as rows a reviewer can
 * edit: the AI's, then any added by hand (§2.3 "+ Add period"). Used by the
 * Compliance Verify dialog and by "Edit holiday periods" on a verified
 * letter (ADR-0178). The candidate screen keeps its own card (TermDates),
 * which this mirrors.
 */
export function HolidayPeriodsEditor({
  periods,
  onChange,
  aiCount = 0,
  aiLabel = 'AI',
  editable = true,
}: {
  periods: Period[];
  onChange: (next: Period[]) => void;
  /** How many of the leading rows the extractor read; the rest are "added by hand". */
  aiCount?: number;
  aiLabel?: string;
  editable?: boolean;
}) {
  const problem = periodsProblem(periods);
  const update = (index: number, patch: Partial<Period>) =>
    onChange(periods.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  return (
    <div className="stack tight">
      {periods.length === 0 ? (
        <div className="muted sm">No holiday periods — add any the letter shows.</div>
      ) : (
        <div className="hp-list">
          <div className="hp-row head">
            <span className="label">#</span>
            <span className="label">From</span>
            <span />
            <span className="label">To</span>
            <span className="label">Source</span>
            <span />
          </div>
          {periods.map((period, index) => (
            <div className="hp-row" key={index}>
              <span className="mono muted">{index + 1}</span>
              {/* dd/mm/yyyy whatever the device's locale (ADR-0140). */}
              <UkDateField
                label={`Holiday ${index + 1} from`}
                labelHidden
                value={period.from}
                disabled={!editable}
                onChange={(from) => update(index, { from })}
              />
              <span className="muted">→</span>
              <UkDateField
                label={`Holiday ${index + 1} to`}
                labelHidden
                value={period.to}
                disabled={!editable}
                onChange={(to) => update(index, { to })}
              />
              <span className="muted xs">{index < aiCount ? aiLabel : 'added by hand'}</span>
              {editable ? (
                <button
                  type="button"
                  className="hp-rm"
                  onClick={() => onChange(periods.filter((_, i) => i !== index))}
                >
                  remove
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
      {editable ? (
        <div className="row wrap">
          <Button size="sm" onClick={() => onChange([...periods, { from: '', to: '' }])}>
            + Add period
          </Button>
          <span className="muted xs">
            for a vacation the AI missed — both dates inclusive, as printed on the letter
          </span>
        </div>
      ) : null}
      {problem && periods.some((p) => p.from || p.to) ? (
        <div className="coral sm">{problem}</div>
      ) : null}
    </div>
  );
}

/** The ranges on file as editable rows (`[2026-12-13,2027-01-11)` → 13–10 Jan). */
export function periodsFrom(ranges: readonly string[] | null | undefined): Period[] {
  return (ranges ?? []).map(parsePeriod).filter((p): p is Period => p !== null);
}

/**
 * "Edit holiday periods" on a VERIFIED term letter (ADR-0178): the candidate
 * screen and the staff profile. Opens the rows in a dialog and replaces the
 * letter's periods with set_term_letter_periods(), which also moves the
 * worker's weekly limit and the letter's expiry. Shown only to a login that
 * may write; the database refuses anyone else whatever the screen shows.
 */
export function EditTermPeriods({
  docId,
  ranges,
  allowed,
  name,
  uploadedAt,
  startOpen = false,
  onClosed,
}: {
  docId: string;
  /** The verified letter's ranges, as the database returns them. */
  ranges: readonly string[] | null;
  allowed: boolean;
  /** For the dialog's title. */
  name: string;
  /** ADR-0183: when the letter was uploaded — its calendar-year fallback expiry counts from it. */
  uploadedAt: string;
  /**
   * ADR-0183: open the dialog straight away, with no button of its own —
   * "Correct term dates first" in the Withdraw approval dialog.
   */
  startOpen?: boolean;
  onClosed?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [periods, setPeriods] = useState<Period[]>(() => (startOpen ? periodsFrom(ranges) : []));
  const [noHolidays, setNoHolidays] = useState(false);
  const [today] = useState(() => ukDay(new Date()));
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!allowed) return null;

  const openDialog = () => {
    setPeriods(periodsFrom(ranges));
    setNoHolidays(false);
    setFailure(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setFailure(null);
    onClosed?.();
  };
  // ADR-0183: as at Verify — none at all ticked, at most a year each, and
  // not leaving the letter expired (the database refuses that too).
  const problem =
    periodsProblem(periods) ??
    termLetterVerifyProblem({ periods, noHolidaysConfirmed: noHolidays, uploadedAt, today });

  const save = () => {
    setFailure(null);
    start(async () => {
      const result = await setTermLetterPeriods(docId, periods, noHolidays);
      if (!result.ok) {
        setFailure(result.message ?? 'The periods could not be saved.');
        return;
      }
      setDone(result.message ?? 'Holiday periods saved.');
      setOpen(false);
      onClosed?.();
      router.refresh();
    });
  };

  return (
    <>
      {startOpen ? null : (
        <Button size="sm" disabled={pending} onClick={openDialog}>
          Edit holiday periods
        </Button>
      )}
      {done ? <span className="green sm">{done}</span> : null}

      <Modal
        open={open}
        title={`Holiday periods — ${name}`}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button tone="primary" disabled={pending || problem !== null} onClick={save}>
              {pending ? 'Saving…' : 'Save periods'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {failure ? <Alert tone="coral">{failure}</Alert> : null}
          <HolidayPeriodsEditor
            periods={periods}
            onChange={setPeriods}
            aiLabel="on file"
            aiCount={(ranges ?? []).length}
          />
          <TermLetterOutcome
            periods={periods}
            uploadedAt={uploadedAt}
            today={today}
            noHolidaysConfirmed={noHolidays}
            onNoHolidaysConfirmed={setNoHolidays}
          />
          <Note>
            The University Term Dates Letter is already verified. Add any vacation the AI did not
            read, or correct a date, as printed on the letter. The weekly limit (48 h in a holiday,
            the term-time limit otherwise) and the letter&rsquo;s expiry follow these periods from
            the moment you save; shifts already booked are not changed. The change is written to the
            activity log with your name.
          </Note>
        </div>
      </Modal>
    </>
  );
}
