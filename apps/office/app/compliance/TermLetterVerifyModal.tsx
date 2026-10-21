'use client';

import { useMemo, useState } from 'react';
import { Avatar, Button, Modal, useTimeFormat } from '@thc/ui';
import { aiBadge } from '../onboarding/view-model';
import { belowDegreeHint, conditionFieldFor, initialBelowDegree } from './conditions';
import { ukDay, ukStamp } from './queue';
import { periodsEdited, periodsFromLetter, termLetterVerifyProblem } from './termDates';
import type { TermPeriod } from './termDates';
import { TermDatesEditor } from './TermDatesEditor';
import type { VerifyConditions, VerifyDates } from './actions';
import type { QueueRow } from './types';

/**
 * Verify a University Term Dates Letter from Needs review or the /staff/:id
 * Documents tab (ADR-0178): the holiday periods the AI read, pre-filled and
 * editable as on the candidate screen, the course level for a student, and
 * — live — when the letter will expire. Verify sends exactly the periods on
 * screen; none at all needs the "no holidays" tick.
 */
export function TermLetterVerifyModal({
  row,
  busy,
  onClose,
  onVerify,
}: {
  row: QueueRow;
  busy: boolean;
  onClose: () => void;
  onVerify: (dates: VerifyDates, conditions: Omit<VerifyConditions, 'staffId'>) => void;
}) {
  const format = useTimeFormat();
  const today = useMemo(() => ukDay(new Date()), []);
  const [periods, setPeriods] = useState<TermPeriod[]>(() => periodsFromLetter(row.term_dates));
  const [noHolidays, setNoHolidays] = useState(false);
  const askLevel = conditionFieldFor(row.item_type, row.rtw_branch) === 'below_degree';
  const initialBelow = initialBelowDegree(row.below_degree_level, row.rtw_check_term_limit);
  const [below, setBelow] = useState(initialBelow);
  const problem = termLetterVerifyProblem({
    periods,
    noHolidaysConfirmed: noHolidays,
    uploadedAt: row.submitted_at,
    today,
  });
  const dirty = periodsEdited(periods, row.term_dates) || noHolidays || below !== initialBelow;

  const verify = () =>
    onVerify(
      {
        termDates: periods.map(({ from, to }) => ({ from, to })),
        noHolidays: periods.length === 0 && noHolidays,
      },
      askLevel ? { belowDegreeLevel: below } : {},
    );

  return (
    <Modal
      open
      wide
      dirty={dirty}
      title={`Verify ${row.item_label}`}
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="green"
            solid
            disabled={busy || problem !== null}
            title={problem ?? undefined}
            onClick={verify}
          >
            Verify
          </Button>
        </>
      }
    >
      <div className="row">
        <Avatar name={row.display_name} size="sm" />
        <div className="sm">
          {row.display_name} · {row.is_candidate ? 'Candidate' : 'Staff'} · {row.item_label} ·
          uploaded {ukStamp(row.submitted_at, format)}
        </div>
      </div>
      <div className="stack">
        <div>
          <b>Term dates read from the letter</b>
          <div className="muted sm">
            Check every holiday period against the letter — correct a date, remove one that is
            wrong, add one the AI missed. The weekly limit is calculated from these dates: 48 hours
            in a holiday week, 20 in term time, and a week that runs across both takes the lower.
          </div>
        </div>
        <TermDatesEditor
          periods={periods}
          onChange={setPeriods}
          editable
          badge={aiBadge(row.ai_confidence, row.needs_manual_review)}
          noHolidaysConfirmed={noHolidays}
          onNoHolidaysConfirmed={setNoHolidays}
          uploadedAt={row.submitted_at}
          today={today}
          previous={row.staff_term_dates ?? null}
        />
      </div>
      {askLevel ? (
        <label className="row sm">
          <input
            type="checkbox"
            checked={below}
            onChange={(event) => setBelow(event.target.checked)}
          />
          <span>
            <b>Course is below degree level</b> — 10 hours a week in term time instead of 20.{' '}
            <span className="muted">{belowDegreeHint(row.rtw_check_term_limit)}</span>
          </span>
        </label>
      ) : null}
    </Modal>
  );
}
