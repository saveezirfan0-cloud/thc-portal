'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Note, Panel, useTimeFormat } from '@thc/ui';
import { parseRate, poundsInput } from '../../roles/money';
import { clearPayRate, savePayRate } from './actions';
import { HOLIDAY_LABEL, payRateFigures, payRateSetLine, storedPence } from './payRate';
import type { PersonalPayRate } from './types';

/**
 * The Pay rate card on the Overview tab (ADR-0072).
 *
 * The product owner's third level: a pay rate is set per role (/roles),
 * per role section of an event (the Shift Builder), and — here — per
 * worker. One optional personal base rate, used for every role they work
 * in place of the role section's; none reads "Uses the role or event
 * rate". The holiday element and the final rate are derived with /roles'
 * own helpers, never stored and never blended (§1.5, §9.8).
 *
 * Money, so the page draws this card only for an office role with
 * finance (`officeCan(role, 'finance')`); a scheduler never sees it, and
 * `staff_pay_rates` returns them no row anyway (ADR-0061). A viewer reads
 * it without the Edit / Clear controls; the database refuses their write
 * too (ADR-0060).
 */
export function PayRateCard({
  staffId,
  payRate,
  problem = null,
  editable,
}: {
  staffId: string;
  /** Null: no personal rate — the role section's rate applies. */
  payRate: PersonalPayRate | null;
  problem?: string | null;
  /** Finance + write, and not a removed profile. */
  editable: boolean;
}) {
  const format = useTimeFormat();
  const [dialog, setDialog] = useState<'edit' | 'clear' | null>(null);
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const current = payRate ? storedPence(payRate) : null;
  const pence = parseRate(typed);
  const typedIsBlank = typed.trim() === '';

  const openEdit = () => {
    setTyped(current === null ? '' : poundsInput(current));
    setFailure(null);
    setDialog('edit');
  };
  const close = () => {
    setDialog(null);
    setFailure(null);
  };

  const save = () => {
    if (pence === null) return;
    setFailure(null);
    start(async () => {
      const result = await savePayRate(staffId, typed);
      if (result.ok) close();
      else setFailure(result.message);
    });
  };

  const clear = () => {
    setFailure(null);
    start(async () => {
      const result = await clearPayRate(staffId);
      if (result.ok) close();
      else setFailure(result.message);
    });
  };

  const shown = current === null ? null : payRateFigures(current);
  const preview = pence === null ? null : payRateFigures(pence);

  return (
    <Panel
      title="Pay rate"
      actions={
        <>
          <span className="muted sm">finance only · the worker sees the base rate</span>
          {editable ? (
            <>
              <Button size="sm" tone="ghost" disabled={pending} onClick={openEdit}>
                {payRate ? 'Edit' : 'Set rate'}
              </Button>
              {payRate ? (
                <Button
                  size="sm"
                  tone="ghost"
                  disabled={pending}
                  onClick={() => {
                    setFailure(null);
                    setDialog('clear');
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </>
          ) : null}
        </>
      }
    >
      {problem ? (
        <Alert tone="coral">The pay rate could not be read: {problem}</Alert>
      ) : shown && payRate ? (
        <div className="kv">
          <span className="k">Personal pay rate (base £/h)</span>
          <span className="mono">
            <b>{shown.base}</b>
          </span>
          <span className="k">{HOLIDAY_LABEL}</span>
          <span className="mono muted">{shown.holiday}</span>
          <span className="k">Final rate</span>
          <span className="mono cyan">{shown.final}</span>
          <span className="k">Updated</span>
          <span className="mono sm muted">{payRateSetLine(payRate, format)}</span>
        </div>
      ) : (
        <Note>
          Uses the role or event rate — each shift pays its role section&rsquo;s base rate.
        </Note>
      )}
      {!problem && payRate ? (
        <span className="muted xs">
          Used for every role this worker works, in place of the role or event rate.
        </span>
      ) : null}

      <Modal
        open={dialog === 'edit'}
        title={payRate ? 'Change personal pay rate' : 'Set personal pay rate'}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button tone="primary" disabled={pending || pence === null} onClick={save}>
              {pending ? 'Saving…' : 'Save rate'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {failure ? <Alert tone="coral">{failure}</Alert> : null}
          <div className="field">
            <label className="label" htmlFor="staff-pay-rate">
              Personal pay rate (base £/h) <span className="coral">*</span>
            </label>
            <div className="input-row pay-rate-row">
              <span className="addon l">£</span>
              <input
                id="staff-pay-rate"
                className="input mono"
                inputMode="decimal"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="0.00"
                aria-describedby="staff-pay-rate-hint"
              />
              <span className="addon">/h</span>
            </div>
            <span className="hint" id="staff-pay-rate-hint">
              {pence === null && !typedIsBlank
                ? 'Enter a rate to the penny, e.g. 13.50.'
                : 'The base rate. Holiday and the final rate are calculated from it.'}
            </span>
          </div>

          {/* §9.8's three columns, live, as on /roles. */}
          <div className="pay-calc" aria-live="polite">
            <div className="c">
              <span className="label">Base</span>
              <span className="v">{preview ? preview.base : '—'}</span>
            </div>
            <div className="c">
              <span className="label">{HOLIDAY_LABEL}</span>
              <span className="v muted">{preview ? preview.holiday : '—'}</span>
            </div>
            <div className="c">
              <span className="label">Final rate</span>
              <span className="v cyan">{preview ? preview.final : '—'}</span>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={dialog === 'clear'}
        title="Clear the personal pay rate?"
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button tone="danger" solid disabled={pending} onClick={clear}>
              Clear
            </Button>
          </>
        }
      >
        {failure ? <Alert tone="coral">{failure}</Alert> : null}
        <p className="sm">
          This worker goes back to the role or event rate on every shift priced from now on. Payroll
          already exported is not changed.
        </p>
      </Modal>
    </Panel>
  );
}
