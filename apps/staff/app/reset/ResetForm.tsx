'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { MIN_LENGTH, checkPassword, passwordOk } from './rules';
import { setPassword } from './actions';

/**
 * A3's form — §10.2, wireframes/staff/auth.html.
 *
 * The checklist updates as they type because the alternative is a worker
 * pressing Save four times to discover three separate rules, on a phone,
 * probably late. The server checks the same three rules with the same
 * function; this is help, not the gate.
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

      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPasswordValue(event.target.value)}
        // "Not one you've used before" (the wireframe) promised a password
        // history nothing enforces. What IS refused is the current password
        // — Supabase Auth's `same_password` — so that is what the hint says.
        hint={`At least ${MIN_LENGTH} characters, with a number. Not the one you use now.`}
      />
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

      <div className="mlist">
        <Check ok={checks.long}>{MIN_LENGTH}+ characters</Check>
        <Check ok={checks.hasNumber}>Contains a number</Check>
        <Check ok={checks.matches}>Both fields match</Check>
      </div>

      <Button type="submit" tone="primary" size="lg" block disabled={pending || !ready}>
        {pending ? 'Saving…' : 'Save password & sign in'}
      </Button>
      <div className="xs muted">Setting a new password signs you out of every other device.</div>
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
