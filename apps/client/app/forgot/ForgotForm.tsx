'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { requestReset } from './actions';

/** A1's form — `wireframes/client/login.html`, state "Forgot password (A1)". */
export function ForgotForm() {
  const [error, formAction, pending] = useActionState(requestReset, null);

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <p className="sm muted">
        Enter the email you sign in with. If it has an account, we’ll send a reset link.
      </p>
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        error={error ? ' ' : undefined}
      />
      <Button type="submit" tone="primary" size="lg" block disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
      <Link href="/login" className="xs" style={{ textAlign: 'center' }}>
        ← Back to sign in
      </Link>
    </form>
  );
}
