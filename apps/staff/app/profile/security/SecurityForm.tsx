'use client';

import { useEffect, useState, useTransition } from 'react';
import { Alert, Button, Input, MobileList, MobileRow, Pill } from '@thc/ui';
import { changePassword, signOutOtherDevices } from '../actions';

/**
 * Security settings — §10.1, `wireframes/staff/profile.html`.
 *
 * Change password, sign out other devices, and the notification-permission
 * state for this device. Nothing else: §10.2 covers the forgotten-password
 * route, which belongs on the signed-out side.
 *
 * The password rule shown is the one enforced — at least 10 characters
 * with a number — and it is checked on the server too. A rule stated on a
 * screen and enforced nowhere is worse than no rule, because it teaches
 * the worker that the screen is decoration.
 */
export function SecurityForm({ email }: { email: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const mismatch = again.length > 0 && next !== again;

  function submit() {
    setNote(null);
    setError(null);
    if (mismatch) {
      setError('The two new passwords don’t match.');
      return;
    }
    start(async () => {
      const result = await changePassword(email, current, next);
      if (!result.ok) setError(result.message);
      else {
        setCurrent('');
        setNext('');
        setAgain('');
        setNote(result.note ?? 'Password updated.');
      }
    });
  }

  return (
    <>
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        hint="At least 10 characters, with a number."
      />
      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={again}
        onChange={(event) => setAgain(event.target.value)}
        {...(mismatch ? { error: 'These don’t match.' } : {})}
      />

      {error ? <Alert tone="coral">{error}</Alert> : null}
      {note ? <Alert tone="green">{note}</Alert> : null}

      <Button
        tone="primary"
        size="lg"
        block
        disabled={pending || current.length === 0 || next.length === 0}
        onClick={submit}
      >
        {pending ? 'Updating…' : 'Update password'}
      </Button>

      <MobileList>
        <SignedInDevices />
        <NotificationRow />
      </MobileList>
    </>
  );
}

function SignedInDevices() {
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <MobileRow
      right={
        <Button
          tone="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await signOutOtherDevices();
              setNote(result.ok ? (result.note ?? 'Done.') : result.message);
            })
          }
        >
          Sign out others
        </Button>
      }
    >
      <div className="t">Signed-in devices</div>
      <div className="s">{note ?? 'This device stays signed in.'}</div>
    </MobileRow>
  );
}

/**
 * Push permission for THIS device (§10.5).
 *
 * Read, never requested here: a permission prompt has to follow a user
 * gesture on the install/notifications screen, and a prompt fired on page
 * load is the one a browser permanently denies. This row reports what that
 * screen achieved.
 */
function NotificationRow() {
  const [state, setState] = useState<'unknown' | NotificationPermission>('unknown');

  useEffect(() => {
    if (typeof Notification === 'undefined') {
      setState('unknown');
      return;
    }
    setState(Notification.permission);
  }, []);

  const label =
    state === 'granted'
      ? 'Allowed on this device'
      : state === 'denied'
        ? 'Blocked in your phone’s settings'
        : state === 'default'
          ? 'Not set up on this device yet'
          : 'Not available in this browser';

  return (
    <MobileRow
      right={
        state === 'granted' ? (
          <Pill tone="green">On</Pill>
        ) : state === 'denied' ? (
          <Pill tone="coral">Off</Pill>
        ) : (
          <Pill>Off</Pill>
        )
      }
    >
      <div className="t">Notifications</div>
      <div className="s">{label}</div>
    </MobileRow>
  );
}
