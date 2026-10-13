'use client';

import { useActionState, useId, useState } from 'react';
import { Alert, Button, Input, PasswordRules } from '@thc/ui';
import { checkPassword, passwordOk } from '@thc/domain';
import { setPassword } from './actions';

/**
 * A3's form — §10.2, `wireframes/public/activate.html` (reset).
 *
 * The checklist updates while typing; the server checks the same rules
 * with the same function (`@thc/domain` password.ts, which `PasswordRules`
 * reads too). This is help, not the gate.
 */
export function ResetForm() {
  const [error, formAction, pending] = useActionState(setPassword, null);
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const rulesId = useId();

  const checks = checkPassword(password, confirm);
  const ready = passwordOk(checks);

  return (
    <form action={formAction} className="auth-form">
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <p className="sm muted">You’ll be signed in straight after.</p>

      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        reveal
        aria-describedby={rulesId}
        value={password}
        onChange={(event) => setPasswordValue(event.target.value)}
        onBlur={() => setTouched(true)}
      />
      <PasswordRules
        id={rulesId}
        value={password}
        confirm={confirm}
        touched={touched}
        confirmTouched={confirmTouched}
      />
      <Input
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        onBlur={() => setConfirmTouched(true)}
        error={confirm.length > 0 && !checks.matches ? 'Passwords don’t match.' : undefined}
      />

      <Button type="submit" tone="primary" size="lg" block disabled={pending || !ready}>
        {pending ? 'Saving…' : 'Save new password'}
      </Button>
      <div className="xs muted auth-note">
        Didn’t request this? Ignore the email — your current password still works. Saving signs you
        out of every other device.
      </div>
    </form>
  );
}
