'use client';

import { useState, useTransition } from 'react';
import { Button } from '@thc/ui';
import { savePayrollId } from './actions';

/**
 * The Payroll ID on the Overview card "Contacts & identity" (ADR-0107).
 *
 * The ID the payroll sheet knows this person by. It arrives from the invite
 * list when they apply (or are already here when the list is loaded); this
 * is where the office sets or corrects one by hand — text, so an ID such as
 * 1641A fits. Setting it does not change the Employee ID: a numeric one
 * becomes the Employee ID at contract signature (`issue_employee_id`), and
 * one that is already issued is never rewritten from here.
 * `set_staff_payroll_id()` refuses a viewer, a removed worker and an ID
 * somebody else holds, whatever this shows.
 */
export function PayrollIdField({
  staffId,
  payrollId,
  editable,
  removed = false,
}: {
  staffId: string;
  /** Null: none on file. Undefined: could not be read. */
  payrollId: string | null | undefined;
  editable: boolean;
  removed?: boolean;
}) {
  const [shown, setShown] = useState(payrollId);
  // Follow the stored value when the page re-reads it (a router refresh).
  const [stored, setStored] = useState(payrollId);
  if (payrollId !== stored) {
    setStored(payrollId);
    setShown(payrollId);
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (shown === undefined || removed) return <span className="muted">—</span>;

  const save = () => {
    setFailure(null);
    start(async () => {
      const value = draft.trim() === '' ? null : draft.trim().toUpperCase();
      const result = await savePayrollId(staffId, value);
      if (result.ok) {
        setShown(value);
        setEditing(false);
      } else setFailure(result.message);
    });
  };

  return (
    <span>
      {editing ? (
        <>
          <input
            className="input"
            style={{ height: 32, width: 150 }}
            aria-label="Payroll ID"
            placeholder="e.g. 1641A"
            maxLength={20}
            value={draft}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
          />{' '}
          <Button size="sm" tone="primary" disabled={pending} onClick={save}>
            Save
          </Button>{' '}
          <Button size="sm" tone="outline" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          {shown ? <b className="mono">{shown}</b> : <span className="muted">not set</span>}
          {editable ? (
            <>
              {' '}
              <Button
                size="sm"
                tone="outline"
                onClick={() => {
                  setDraft(shown ?? '');
                  setFailure(null);
                  setEditing(true);
                }}
              >
                {shown ? 'Edit' : 'Set'}
              </Button>
            </>
          ) : null}
        </>
      )}
      {failure ? (
        <>
          <br />
          <span className="coral sm">{failure}</span>
        </>
      ) : null}
    </span>
  );
}
