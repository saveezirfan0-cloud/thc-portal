'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { requestReset } from './actions';
import { RESET_LINK_VALIDITY, RESET_SENDER } from './copy';

/**
 * A1 Forgot password — §10.2, wireframes/staff/auth.html.
 *
 * The wireframe puts "‹ Back to sign in" at the very top, as the collapsed
 * header's title. The shared AuthCard has no slot above its heading, so the
 * link is the first thing in the body instead — above the copy, never under
 * the small print.
 */
export function ForgotForm() {
  const [error, formAction, pending] = useActionState(requestReset, null);

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row">
        <Link href="/login" className="sm">
          ‹ Back to sign in
        </Link>
      </div>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <p className="sm muted">
        Enter the email you signed up with and we’ll send a link to set a new one. The link is valid
        for {RESET_LINK_VALIDITY}.
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
        The email comes from {RESET_SENDER}. If you don’t see it, check spam — or contact the
        office.
      </div>
    </form>
  );
}
