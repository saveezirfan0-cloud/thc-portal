'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { PASSWORD_MIN_LENGTH, checkPassword, passwordOk } from '@thc/domain';
import { acceptInvite } from './actions';

/** The invitation's password form — the same checks as A3 (/reset). */
export function InviteForm({ token, type }: { token: string; type: string }) {
  const [error, formAction, pending] = useActionState(acceptInvite, null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const checks = checkPassword(password, confirm);
  const ready = passwordOk(checks);

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="type" value={type} />
      <Input
        label="Choose a password"
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
        label="Confirm password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        error={confirm.length > 0 && !checks.matches ? 'Passwords don’t match.' : undefined}
      />
      <Button type="submit" tone="primary" size="lg" block disabled={pending || !ready}>
        {pending ? 'Setting up…' : 'Set password and sign in'}
      </Button>
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
