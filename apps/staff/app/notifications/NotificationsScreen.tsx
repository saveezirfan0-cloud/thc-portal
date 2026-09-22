'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Button, MobileList, MobileRow, Pill } from '@thc/ui';
import { enablePush, pushCopy, pushState, readEnvironment } from '../../lib/push';
import type { PushState } from '../../lib/push';
import { savePushSubscription } from './actions';

/**
 * "Turn on notifications" — §10.5, wireframes/staff/auth.html.
 *
 * A pre-prompt before the system dialog, because the browser's permission
 * prompt can only be answered once: a worker who taps Block on a dialog
 * they did not expect has to be talked through their phone's settings to
 * undo it. So this screen says what the four notifications are first, and
 * asks only on the button.
 *
 * The request runs inside the click handler on purpose. Safari drops a
 * permission request that is not tied to a user gesture, and the failure
 * is invisible: no dialog, no error, a button that appears to do nothing.
 */
const REGISTER = [
  { code: 'N5', title: 'Shift invitations', detail: 'First to confirm takes the slot.' },
  {
    code: 'N6',
    title: '“I’m ready” — the 12:00 deadline',
    detail: 'Miss it and you are removed from the shift.',
  },
  {
    code: 'N9',
    title: 'Time to check in / check out',
    detail: '30 minutes before your start and your end.',
  },
  {
    code: 'N1',
    title: 'Document expiry warnings',
    detail: 'A month, 2 weeks and 1 week before — and on the day.',
  },
];

export function NotificationsScreen() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'coral' | 'green'; text: string } | null>(null);

  useEffect(() => {
    setState(pushState(readEnvironment()));
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    const result = await enablePush();
    if (!result.ok) {
      setState(result.state);
      setMessage({ tone: 'coral', text: pushCopy(result.state).detail });
      setBusy(false);
      return;
    }
    const saved = await savePushSubscription(result.subscription);
    if (!saved.ok) {
      // The browser subscribed and the record did not take it. Saying
      // "notifications are on" here would be a lie the worker only finds
      // out about when they miss an invitation.
      setMessage({ tone: 'coral', text: saved.error });
      setBusy(false);
      return;
    }
    setState('granted');
    setMessage({ tone: 'green', text: 'Notifications are on for this device.' });
    setBusy(false);
  };

  const copy = state ? pushCopy(state) : null;

  return (
    <>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {state === 'granted' ? (
        <Alert tone="green">
          <b>Notifications are on.</b> Invitations, the 12:00 reminder and check-in alerts reach
          this device.
        </Alert>
      ) : null}

      {state === 'needs-install' ? (
        <Alert tone="cyan">
          On iPhone, notifications only work from the installed app — not from a Safari tab (iOS
          16.4+). <Link href="/install">Add it to your home screen</Link>, open it from there, and
          come back to this screen.
        </Alert>
      ) : null}

      {state === 'unconfigured' ? (
        <Alert tone="amber">
          <b>Notifications are not switched on for this version of the app.</b>
          <br />
          <span className="xs">
            The office is still setting them up, so nothing is sent yet — to anyone. Keep checking
            Shifts and Invites in the app until this banner goes away.
          </span>
        </Alert>
      ) : null}

      <p className="sm muted">
        Everything time-critical arrives as a notification — and they work even when the app is
        closed:
      </p>

      <MobileList>
        {REGISTER.map((item) => (
          <MobileRow key={item.code}>
            <span className="row" style={{ gap: 'var(--sp-8)', alignItems: 'flex-start' }}>
              <Pill tone="purple">{item.code}</Pill>
              <span>
                <span className="t">{item.title}</span>
                <span className="s">{item.detail}</span>
              </span>
            </span>
          </MobileRow>
        ))}
      </MobileList>

      <Button
        type="button"
        tone="primary"
        size="lg"
        block
        disabled={busy || !copy?.actionable || state === 'needs-install'}
        onClick={() => void turnOn()}
      >
        {busy ? 'Asking your phone…' : 'Turn on notifications'}
      </Button>

      {state && state !== 'granted' && !copy?.actionable ? (
        <div className="xs muted" style={{ textAlign: 'center' }}>
          {copy?.detail}
        </div>
      ) : (
        <div className="xs muted" style={{ textAlign: 'center' }}>
          You can change this later in your phone’s settings.
        </div>
      )}
    </>
  );
}
