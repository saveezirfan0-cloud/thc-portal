'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { Alert, Button, Checkbox } from '@thc/ui';
import { signIn } from './actions';
import { PASSWORD_HINT, REMEMBER_LABEL } from './copy';

export function LoginForm({ next }: { next?: string }) {
  const [error, formAction, pending] = useActionState(signIn, null);
  return <LoginFields error={error} pending={pending} next={next} action={formAction} />;
}

/**
 * A0 Sign in and its error state (§1.4, wireframes/backoffice/login.html
 * states `signin` and `error`), drawn from props so a test can render both.
 *
 * The fields are written out rather than taken from `<Input>` because the
 * wireframe's error state needs two things `<Input>` cannot give: an Email
 * field with the red border and NO text under it (login.html:52 — an empty
 * `role="alert"` is announced by a screen reader as nothing, and takes a
 * blank line), and a Password field with its error line AND the "Forgot
 * password?" hint together (login.html:53 — `<Input>` hides the hint once
 * there is an error).
 */
export function LoginFields({
  error,
  pending,
  next,
  action,
}: {
  error: string | null;
  pending: boolean;
  next?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [email, setEmail] = useState('');
  // Ticked by default (login.html:39). It only lengthens the session cookies'
  // life on this device; the server action reads it (sessionCookies.ts).
  const [remember, setRemember] = useState(true);
  const emailId = useId();
  const passwordId = useId();
  const invalid = Boolean(error);

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-16)' }}>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="field">
        <label className="label" htmlFor={emailId}>
          Email
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="username"
          required
          // Keep what they typed. Clearing the field on a failed attempt makes a
          // typo indistinguishable from a wrong password, and means retyping.
          defaultValue={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={invalid ? true : undefined}
          className={invalid ? 'input err' : 'input'}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={passwordId}>
          Password
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={invalid ? true : undefined}
          className={invalid ? 'input err' : 'input'}
        />
        {invalid ? (
          <span className="error" role="alert">
            {PASSWORD_HINT}
          </span>
        ) : null}
        {/* A1 (§10.2), under the password where the wireframe puts it. */}
        <span className="hint">
          <Link href="/login/forgot">Forgot password?</Link>
        </span>
      </div>
      <Checkbox name="remember" checked={remember} onChange={setRemember}>
        {REMEMBER_LABEL}
      </Checkbox>
      <Button type="submit" tone="primary" size="lg" block disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
