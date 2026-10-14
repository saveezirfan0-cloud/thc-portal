'use client';

import { useState, useTransition } from 'react';
import { Alert, Switch } from '@thc/ui';
import { setLineupEmails } from './actions';

/**
 * The client card's two line-up email switches (ADR-0135 §3), both on by
 * default:
 *
 *   · "Line-up fully confirmed" (CP2) — once per event, when every role of
 *     an upcoming event is confirmed;
 *   · "Line-up changed after the Allocation Timesheet" (CP3) — someone
 *     joins or leaves after the sheet went, at most once an hour.
 *
 * Both go to the event's timesheet recipients (the event's own list, else
 * the addresses above), never between 23:00 and 07:00 UK. Switching one off
 * also withdraws any of that kind still queued. Without the 'write'
 * permission (a viewer, ADR-0060) the state is text, with no control.
 */
export type LineupEmailKind = 'confirmed' | 'changed';

const LABEL: Record<LineupEmailKind, string> = {
  confirmed: 'Line-up fully confirmed',
  changed: 'Line-up changed after the Allocation Timesheet was sent',
};

export function LineupEmails({
  clientId,
  confirmed,
  changed,
  canWrite,
}: {
  clientId: string;
  confirmed: boolean;
  changed: boolean;
  canWrite: boolean;
}) {
  return (
    <span className="stack tight">
      <LineupEmailSwitch clientId={clientId} kind="confirmed" on={confirmed} canWrite={canWrite} />
      <LineupEmailSwitch clientId={clientId} kind="changed" on={changed} canWrite={canWrite} />
      <span className="muted xs">
        to the event&rsquo;s timesheet recipients · never 23:00&ndash;07:00 UK · no names, no money
      </span>
    </span>
  );
}

function LineupEmailSwitch({
  clientId,
  kind,
  on,
  canWrite,
}: {
  clientId: string;
  kind: LineupEmailKind;
  on: boolean;
  canWrite: boolean;
}) {
  const [checked, setChecked] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const description = `${LABEL[kind]} — ${checked ? 'On' : 'Off'}`;

  if (!canWrite) return <span>{description}</span>;

  const change = (next: boolean) => {
    setError(null);
    setChecked(next);
    startSaving(async () => {
      const result = await setLineupEmails(clientId, kind, next);
      if (!result.ok) {
        setChecked(!next);
        setError(result.message);
      }
    });
  };

  return (
    <>
      <Switch checked={checked} onChange={change} disabled={saving} label={description} />
      {error ? <Alert tone="coral">{error}</Alert> : null}
    </>
  );
}
