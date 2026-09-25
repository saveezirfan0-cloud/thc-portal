'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { Alert, Button, Input, InputRow } from '@thc/ui';
import { signIn } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [error, formAction, pending] = useActionState(signIn, null);
  return <LoginFields error={error} pending={pending} next={next} action={formAction} />;
}

/* A bare text link has the height of its 12px line. On the Staff App every
   control clears the tap floor (§1.2, the design-engine brief); the auth
   card renders outside the app frame, so the link takes it here. */
const TAP_LINK: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-12)',
};

/**
 * A0 and A0 · wrong password (§10.2, wireframes/staff/auth.html), drawn
 * from props so a test can render the error state.
 *
 * The wrong-password state is ONE coral alert and a red border on the
 * password field: the email field stays plain (it is not the one that was
 * wrong — and saying so would tell an attacker the account exists, §1.7),
 * and nothing is printed under the password, because the alert already
 * carries the whole message.
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

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-16)' }}>
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
      <PasswordField invalid={Boolean(error)} />
      <Button type="submit" tone="primary" size="lg" block disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      {/* A1 (§10.2). Under the button, where the wireframe puts it — a
          worker who cannot sign in has nowhere else to look. */}
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link href="/forgot" className="sm" style={TAP_LINK}>
          Forgot password?
        </Link>
      </div>
    </form>
  );
}

/**
 * The password with the wireframe's `show` addon: a real button, so it is
 * in the tab order and takes the focus ring, and it publishes its state
 * (`aria-pressed`) rather than only changing its word. Its height is the
 * input's, and it is never narrower than the tap floor.
 */
function PasswordField({ invalid }: { invalid: boolean }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        Password
      </label>
      <InputRow>
        <input
          id={id}
          name="password"
          type={shown ? 'text' : 'password'}
          autoComplete="current-password"
          required
          aria-invalid={invalid ? true : undefined}
          className={`input${invalid ? ' err' : ''}`}
        />
        <button
          type="button"
          className="addon"
          aria-pressed={shown}
          aria-controls={id}
          onClick={() => setShown((value) => !value)}
          style={{ minWidth: 'var(--tap-min)', cursor: 'pointer' }}
        >
          {shown ? 'hide' : 'show'}
        </button>
      </InputRow>
    </div>
  );
}
