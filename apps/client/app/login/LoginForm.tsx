'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { KEEP_SIGNED_IN_FIELD } from '@thc/db';
import { Alert, Button, Checkbox, Input } from '@thc/ui';
import { signIn } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [error, formAction, pending] = useActionState(signIn, null);
  const [email, setEmail] = useState('');
  // Ticked by default, as the wireframe draws it. Controlled so that a failed
  // attempt (React resets an uncontrolled form after the action) keeps it.
  const [keepSignedIn, setKeepSignedIn] = useState(true);

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        // Keep what they typed. Clearing the field on a failed attempt makes a
        // typo indistinguishable from a wrong password, and means retyping.
        defaultValue={email}
        onChange={(event) => setEmail(event.target.value)}
        error={error ? ' ' : undefined}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={error ? 'Check your password — it is case-sensitive.' : undefined}
      />
      {/* A1 (§10.2). The wireframe keeps it with the password field at
          every width, and in the error state, which is when it is needed. */}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Link href="/forgot" className="xs">
          Forgot password?
        </Link>
      </div>
      {/* ADR-0030: ticked → the session survives closing the browser (30
          days since last use); unticked → it ends with the browser. It only
          changes the cookie lifetime on this device, nothing server-side. */}
      <Checkbox
        name={KEEP_SIGNED_IN_FIELD}
        value="1"
        checked={keepSignedIn}
        onChange={setKeepSignedIn}
      >
        Keep me signed in on this device
      </Checkbox>
      <Button type="submit" tone="primary" size="lg" block disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
