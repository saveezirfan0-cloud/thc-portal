'use client';

import { useState, useTransition } from 'react';
import { Pill } from '@thc/ui';
import { saveGender } from './actions';

const LABEL: Readonly<Record<'M' | 'F', string>> = { M: 'Male', F: 'Female' };

/**
 * Gender on the Overview card "Contacts & identity" (ADR-0077).
 *
 * The worker gives it on onboarding step 7 (the HMRC New Starter
 * checklist, M or F). A "Male staff only" role section books men only, so
 * a worker with none on file — brought across from payroll, or onboarded
 * before step 7 asked — is left out of those sections until the office
 * records it here. Any office login that may write; `set_staff_gender()`
 * refuses a viewer and a removed worker whatever this shows.
 */
export function GenderField({
  staffId,
  gender,
  editable,
}: {
  staffId: string;
  /** Null: not on file. Undefined: could not be read. */
  gender: 'M' | 'F' | null | undefined;
  editable: boolean;
}) {
  const [shown, setShown] = useState(gender);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (shown === undefined) return <span className="muted">—</span>;

  const change = (next: string) => {
    const value = next === 'M' || next === 'F' ? next : null;
    setFailure(null);
    start(async () => {
      const result = await saveGender(staffId, value);
      if (result.ok) setShown(value);
      else setFailure(result.message);
    });
  };

  return (
    <span>
      {shown ? LABEL[shown] : <Pill tone="amber">not recorded</Pill>}
      {editable ? (
        <>
          {' '}
          <select
            className="input"
            style={{ height: 32, width: 150 }}
            aria-label="Gender"
            value={shown ?? ''}
            disabled={pending}
            onChange={(event) => change(event.target.value)}
          >
            <option value="">Not recorded</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
        </>
      ) : null}
      {shown === null ? (
        <>
          <br />
          <span className="muted sm">
            Needed for roles a client has asked to staff with men only — they are left out of those
            until it is recorded.
          </span>
        </>
      ) : null}
      {failure ? (
        <>
          <br />
          <span className="coral sm">{failure}</span>
        </>
      ) : null}
    </span>
  );
}
