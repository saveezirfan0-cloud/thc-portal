'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { Alert, Button, Checkbox, Input } from '@thc/ui';
import { signIn } from './actions';
import { REMEMBER_LABEL } from './copy';

/**
 * A0 Sign in — `wireframes/client/login.html` (§1.4, §11.1).
 *
 * "Forgot password?" rides the password label's row and the field has a
 * Show addon, as the wireframe draws both at every width; "Keep me signed
 * in on this device" is ticked by default. Unticked, the session cookies
 * end with the browser (ADR-0035).
 */
export function LoginForm({ next }: { next?: string }) {
  const [error, formAction, pending] = useActionState(signIn, null);
  const [email, setEmail] = useState('');
  const [shown, setShown] = useState(false);
  const [remember, setRemember] = useState(true);
  const passwordId = useId();
  const hintId = useId();

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
      <div className="field">
        <div className="row">
          <label className="label" htmlFor={passwordId}>
            Password
          </label>
          {/* A1 (§10.2). With the password at every width, and in the error
              state, which is when it is needed. */}
          <Link href="/forgot" className="xs" style={{ marginLeft: 'auto' }}>
            Forgot password?
          </Link>
        </div>
        <div className="input-row">
          <input
            id={passwordId}
            className={`input${error ? ' err' : ''}`}
            name="password"
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? hintId : undefined}
          />
          {/* Its name is its text, "Show" / "Hide", so it never also answers
              to the field's label. */}
          <button
            type="button"
            className="addon"
            style={{ cursor: 'pointer' }}
            aria-pressed={shown}
            aria-controls={passwordId}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? 'Hide' : 'Show'}
          </button>
        </div>
        {error ? (
          <span id={hintId} className="error" role="alert">
            Check your password — it is case-sensitive.
          </span>
        ) : null}
      </div>
      <Checkbox name="remember" value="1" checked={remember} onChange={setRemember}>
        {REMEMBER_LABEL}
      </Checkbox>
      <Button type="submit" tone="primary" size="lg" block disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
