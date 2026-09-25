'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { requestReset } from './actions';
import { RESET_SENDER } from './copy';

export function ForgotForm() {
  const [error, formAction, pending] = useActionState(requestReset, null);
  return <ForgotFields error={error} pending={pending} action={formAction} />;
}

/**
 * A1 Forgot password — §10.2, wireframes/backoffice/login.html:64-68,
 * drawn from props so a test can render it.
 */
export function ForgotFields({
  error,
  pending,
  action,
}: {
  error: string | null;
  pending: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-16)' }}>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <p className="sm muted" style={{ textAlign: 'center' }}>
        Enter the email you sign in with. We&apos;ll send a reset link from{' '}
        <span className="mono">{RESET_SENDER}</span>.
      </p>
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        aria-invalid={error ? true : undefined}
        className={error ? 'err' : undefined}
      />
      <Button type="submit" tone="primary" size="lg" block disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link href="/login" className="sm">
          ← Back to sign in
        </Link>
      </div>
    </form>
  );
}
