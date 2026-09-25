'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { signIn } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [error, formAction, pending] = useActionState(signIn, null);
  const [email, setEmail] = useState('');

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
      {/* A1 (§10.2). Under the password field, where the wireframe hangs it,
          and still there in the error state — that is when it is needed. */}
      <Link href="/forgot" className="sm">
        Forgot password?
      </Link>
      <Button type="submit" tone="primary" size="lg" block disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
