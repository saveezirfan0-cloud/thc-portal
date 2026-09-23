'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { requestReset } from './actions';

export function ForgotForm() {
  const [error, formAction, pending] = useActionState(requestReset, null);

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <p className="sm muted">
        Enter the email you signed up with and we’ll send a link to set a new one. The link is valid
        for 60 minutes.
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
      <div className="xs muted">
        The email comes from admin@thehospitalitycompany.co.uk. If you don’t see it, check spam — or
        contact the office.
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link href="/login" className="sm">
          ‹ Back to sign in
        </Link>
      </div>
    </form>
  );
}
