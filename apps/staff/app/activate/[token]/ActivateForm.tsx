'use client';

import { useActionState, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, AuthCard, Button, Input, Pill } from '@thc/ui';
import type { ActivationTokenType } from '@thc/db/activation';
import { activateAccount } from '../actions';
import type { ActivateState } from '../actions';
import { MIN_LENGTH, activationOk, checkActivationPassword } from '../rules';
import type { Personal } from '../rules';
import { LinkSpent } from '../LinkSpent';
import '../activate.css';

/**
 * "Activate · set password" — wireframes/public/activate.html.
 *
 * The checklist is live because the alternative is a candidate pressing
 * the button four times on a phone to discover four rules. It is help,
 * not the gate: the action checks the same function, and checks "not
 * your name or email" again against the account once the link is
 * verified — `person` is only what the page could read beforehand, and
 * may be null.
 *
 * The card is rendered here rather than by the page so that the spent
 * link can take the whole card over: the wireframe's expired variant
 * swaps the heading for a coral "Link expired" pill and "This link has
 * expired", and drops the "set your password" lead that would otherwise
 * sit above the alert contradicting it.
 */
const INITIAL: ActivateState = { error: null };

export function ActivateForm({
  token,
  type,
  person,
  heading,
  lead,
  footer,
}: {
  token: string;
  type: ActivationTokenType;
  person: Personal | null;
  heading: string;
  lead: ReactNode;
  footer: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(activateAccount, INITIAL);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState(false);
  const passwordId = useId();

  if (state.expired) {
    return (
      <AuthCard product="Account activation" heading="This link has expired" footer={footer}>
        <div className="row">
          <Pill tone="coral">Link expired</Pill>
        </div>
        <p className="sm muted">Activation links work once and for a limited time.</p>
        <LinkSpent message={state.error} />
      </AuthCard>
    );
  }

  const checks = checkActivationPassword(password, confirm, person);
  const ready = activationOk(checks);
  const touched = password.length > 0;
  const mark = (ok: boolean) => (!touched ? undefined : ok ? 'ok' : 'bad');

  return (
    <AuthCard product="Account activation" heading={heading} footer={footer}>
      <p className="sm muted">{lead}</p>
      <form action={formAction} className="act-form">
        {state.error ? <Alert tone="coral">{state.error}</Alert> : null}
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="type" value={type} />

        <div className="field">
          <label className="label" htmlFor={passwordId}>
            Password
          </label>
          <div className="input-row">
            <input
              id={passwordId}
              className="input"
              name="password"
              type={shown ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="addon"
              aria-pressed={shown}
              aria-controls={passwordId}
              onClick={() => setShown((s) => !s)}
            >
              {shown ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <ul className="act-rules" aria-label="Password rules">
          <li className={mark(checks.long)}>At least {MIN_LENGTH} characters</li>
          <li className={mark(checks.hasNumber)}>Contains a number</li>
          <li className={mark(checks.hasLetter)}>Contains a letter</li>
          <li className={mark(checks.notPersonal)}>Not your name or email</li>
        </ul>

        <Input
          label="Confirm password"
          name="confirm"
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={confirm.length > 0 && !checks.matches ? 'Passwords don’t match' : undefined}
        />

        <Button type="submit" tone="primary" size="lg" block disabled={pending || !ready}>
          {pending ? 'Activating…' : 'Activate my account'}
        </Button>
      </form>
    </AuthCard>
  );
}
