'use client';

import { useActionState, useId, useState } from 'react';
import { Alert, Button, Input, PasswordRules, Toast } from '@thc/ui';
import { checkPassword, passwordOk } from '@thc/domain';
import { changePassword } from './actions';
import type { ChangePasswordState } from './actions';
import { PASSWORD_COPY } from './copy';

/**
 * "Change password" on Your account (ADR-0051).
 *
 * The checklist is /reset's (apps/client/app/reset/ResetForm.tsx): the
 * shared `PasswordRules`, which reads the same `checkPassword()` the server
 * action runs, so a password ticked here is never refused there or the
 * other way round. It is help, not the gate — the server action checks
 * again and also re-verifies the current password.
 */
export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, null);
  // The answer the customer has since edited a field after. A refusal is
  // about what was submitted; once they change it, the old sentence ("Your
  // current password is incorrect.") would sit beside the form's own live
  // check ("Passwords don't match.") as if both were true now.
  const [editedAfter, setEditedAfter] = useState<ChangePasswordState | null>(null);
  const refusal = serverRefusal(state, editedAfter);

  return (
    <form action={formAction} className="acct-form">
      {refusal ? <Alert tone="coral">{refusal}</Alert> : null}
      {state?.ok ? (
        <Toast tone={isWarning(state) ? 'amber' : 'green'}>{state.message}</Toast>
      ) : null}
      {/* Keyed on the count of successful changes: a success clears the
          fields, a refusal leaves what was typed so it can be corrected. */}
      <PasswordFields
        key={state?.round ?? 0}
        pending={pending}
        onEdit={() => setEditedAfter(state)}
      />
    </form>
  );
}

/**
 * The server's refusal to show, or null: none once the customer has edited
 * a field since that answer came back (`editedAfter` is the answer they
 * edited after). The next submit brings a new answer, shown again.
 */
export function serverRefusal(
  state: ChangePasswordState | null,
  editedAfter: ChangePasswordState | null,
): string | null {
  if (!state || state.ok) return null;
  return state === editedAfter ? null : state.message;
}

/**
 * A change that went through but left something for the customer to do —
 * today the one case where the other devices could not be signed out.
 * That is amber (needs action), not green: the password is new, but the
 * old sessions are still live.
 *
 * Read from the action's own `tone` when it carries one, and otherwise from
 * the message, which is the copy constant for exactly that outcome.
 */
function isWarning(state: ChangePasswordState): boolean {
  if (state.tone === 'warning') return true;
  return state.message === PASSWORD_COPY.changedOthersKept;
}

function PasswordFields({ pending, onEdit }: { pending: boolean; onEdit: () => void }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const rulesId = useId();

  const checks = checkPassword(password, confirm);
  const ready = current.length > 0 && passwordOk(checks);

  return (
    <>
      <Input
        label="Current password"
        name="current"
        type="password"
        autoComplete="current-password"
        required
        reveal
        value={current}
        onChange={(event) => {
          setCurrent(event.target.value);
          onEdit();
        }}
      />
      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        reveal
        aria-describedby={rulesId}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          onEdit();
        }}
        onBlur={() => setTouched(true)}
      />
      <PasswordRules
        id={rulesId}
        value={password}
        confirm={confirm}
        touched={touched}
        confirmTouched={confirmTouched}
      />
      <Input
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(event) => {
          setConfirm(event.target.value);
          onEdit();
        }}
        onBlur={() => setConfirmTouched(true)}
        error={confirm.length > 0 && !checks.matches ? 'Passwords don’t match.' : undefined}
      />
      <div className="acct-submit">
        <Button type="submit" tone="primary" disabled={pending || !ready}>
          {pending ? 'Saving…' : 'Change password'}
        </Button>
        <span className="xs muted">Saving signs you out of every other device.</span>
      </div>
    </>
  );
}
