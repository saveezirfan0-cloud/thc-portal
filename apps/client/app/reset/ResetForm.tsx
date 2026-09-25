'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { PASSWORD_MIN_LENGTH, checkPassword, passwordOk } from '@thc/domain';
import { setPassword } from './actions';

/**
 * A3's form — §10.2, `wireframes/public/activate.html` (reset).
 *
 * The checklist updates while typing; the server checks the same rules
 * with the same function (`@thc/domain` password.ts). This is help, not
 * the gate.
 */
export function ResetForm() {
  const [error, formAction, pending] = useActionState(setPassword, null);
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');

  const checks = checkPassword(password, confirm);
  const ready = passwordOk(checks);

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <p className="sm muted">You’ll be signed in straight after.</p>

      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPasswordValue(event.target.value)}
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

      <Button type="submit" tone="primary" size="lg" block disabled={pending || !ready}>
        {pending ? 'Saving…' : 'Save new password'}
      </Button>
      <div className="xs muted" style={{ textAlign: 'center' }}>
        Didn’t request this? Ignore the email — your current password still works. Saving signs you
        out of every other device.
      </div>
    </form>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="mrow" style={{ padding: '6px 0' }}>
      <span className={ok ? 'green' : 'coral'} aria-hidden="true">
        {ok ? '✓' : '✕'}
      </span>
      <span className="sm">{children}</span>
    </div>
  );
}
