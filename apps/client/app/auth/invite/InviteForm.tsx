'use client';

import { useActionState, useId, useState } from 'react';
import { Alert, Button, Input, PasswordRules } from '@thc/ui';
import { checkPassword, passwordOk } from '@thc/domain';
import { acceptInvite } from './actions';

/** The invitation's password form — the same checks as A3 (/reset). */
export function InviteForm({ token, type }: { token: string; type: string }) {
  const [error, formAction, pending] = useActionState(acceptInvite, null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const rulesId = useId();
  const checks = checkPassword(password, confirm);
  const ready = passwordOk(checks);

  return (
    <form action={formAction} className="auth-form">
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="type" value={type} />
      <Input
        label="Choose a password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        reveal
        aria-describedby={rulesId}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
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
        label="Confirm password"
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
        {pending ? 'Setting up…' : 'Set password and sign in'}
      </Button>
    </form>
  );
}
