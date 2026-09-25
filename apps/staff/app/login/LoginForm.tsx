'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { Alert, Button, Input } from '@thc/ui';
import { signIn } from './actions';

/**
 * A0 Login — §10.2, wireframes/staff/auth.html.
 *
 * The wrong-password state is ONE coral alert, and only the password
 * field is marked: the email is left plain (auth.html "A0 Login · wrong
 * password"), and no second sentence is printed under the field. The
 * password has the wireframe's "show" addon, at the 44px minimum.
 */
export function LoginForm({ next }: { next?: string }) {
  const [error, formAction, pending] = useActionState(signIn, null);
  const [email, setEmail] = useState('');
  const [shown, setShown] = useState(false);
  const passwordId = useId();

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
      />
      <div className="field">
        <label className="label" htmlFor={passwordId}>
          Password
        </label>
        <div className="input-row">
          <input
            id={passwordId}
            className={`input${error ? ' err' : ''}`}
            name="password"
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            required
            aria-invalid={error ? true : undefined}
          />
          <button
            type="button"
            className="addon"
            aria-pressed={shown}
            aria-controls={passwordId}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? 'hide' : 'show'}
          </button>
        </div>
      </div>
      <Button type="submit" tone="primary" size="lg" block disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      {/* A1 (§10.2). Under the button, where the wireframe puts it — a
          worker who cannot sign in has nowhere else to look. */}
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link href="/forgot" className="sm">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
