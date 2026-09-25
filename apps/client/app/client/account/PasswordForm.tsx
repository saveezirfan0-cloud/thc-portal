'use client';

import { useActionState, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Input, Toast } from '@thc/ui';
import { PASSWORD_MIN_LENGTH, checkPassword, passwordOk } from '@thc/domain';
import { changePassword } from './actions';

/**
 * "Change password" on Your account (ADR-0036).
 *
 * The checklist is /reset's (apps/client/app/reset/ResetForm.tsx): same
 * rules, same function, same wording, so a password ticked here is never
 * refused there or the other way round. It is help, not the gate — the
 * server action checks again and also re-verifies the current password.
 */
export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, null);

  return (
    <form action={formAction} className="acct-form">
      {state && !state.ok ? <Alert tone="coral">{state.message}</Alert> : null}
      {state?.ok ? <Toast tone="green">{state.message}</Toast> : null}
      {/* Keyed on the count of successful changes: a success clears the
          fields, a refusal leaves what was typed so it can be corrected. */}
      <PasswordFields key={state?.round ?? 0} pending={pending} />
    </form>
  );
}

function PasswordFields({ pending }: { pending: boolean }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const checks = checkPassword(password, confirm);
  const ready = current.length > 0 && passwordOk(checks);

  return (
    <>
      <Input
        label="Current password"
        name="current"
        type="password"
        autoComplete="current-password"
        required
        reveal
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <div className="mlist">
        <Check ok={checks.long}>At least {PASSWORD_MIN_LENGTH} characters</Check>
        <Check ok={checks.hasNumber}>Contains a number</Check>
        <Check ok={checks.matches}>Both fields match</Check>
      </div>
      <Input
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        error={confirm.length > 0 && !checks.matches ? 'Passwords don’t match.' : undefined}
      />
      <div className="acct-submit">
        <Button type="submit" tone="primary" disabled={pending || !ready}>
          {pending ? 'Saving…' : 'Change password'}
        </Button>
        <span className="xs muted">Saving signs you out of every other device.</span>
      </div>
    </>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="mrow acct-check">
      <span className={ok ? 'green' : 'coral'} aria-hidden="true">
        {ok ? '✓' : '✕'}
      </span>
      <span className="sm">{children}</span>
    </div>
  );
}
