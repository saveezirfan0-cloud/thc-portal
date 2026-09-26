'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Button, MobileList, MobileRow, Pill } from '@thc/ui';
import {
  currentSubscription,
  enablePush,
  pushCopy,
  pushState,
  readEnvironment,
} from '../../lib/push';
import type { PushState } from '../../lib/push';
import { savePushSubscription } from './actions';
import './notifications.css';

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
// The pill is a plain label. The register's own codes (N5, N6, N9, N1 in
// §8) are the office's and the build's vocabulary; to a worker they are
// noise that reads like an error code (audit, screens table).
const REGISTER = [
  { label: 'Invitations', title: 'Shift invitations', detail: 'First to confirm takes the slot.' },
  {
    label: 'Deadline',
    title: '“I’m ready” — the 12:00 deadline',
    detail: 'Miss it and you’re removed from the shift.',
  },
  {
    label: 'Check-in',
    title: 'Time to check in / check out',
    detail: '30 minutes before start and end.',
  },
  {
    label: 'Documents',
    title: 'Document expiry warnings',
    detail: 'A month, 2 weeks, 1 week before — and on the day.',
  },
];

export function NotificationsScreen({
  initialState = null,
}: {
  /** The state to open on — for rendering each state without a browser. */
  initialState?: PushState | null;
} = {}) {
  const [state, setState] = useState<PushState | null>(initialState);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'coral' | 'green'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const current = pushState(readEnvironment());
      if (!cancelled) setState(current);
      // A permission that says "granted" with no subscription behind it is
      // the state iOS leaves behind when it revokes one (PushStatus makes
      // the same call). Shown as "turn these on" — the button re-subscribes
      // — rather than as working.
      if (current === 'granted' && !(await currentSubscription()) && !cancelled) {
        setState('default');
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
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
      {/* The wireframe's hero: the bell on purple, then the screen's name. */}
      <div className="auth-hero notif-hero">
        <span className="logo lg" aria-hidden="true">
          🔔
        </span>
        <h2 className="name">Turn on notifications</h2>
      </div>

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

      <div className="notif-register">
        <MobileList>
          {REGISTER.map((item) => (
            <MobileRow key={item.label}>
              <span className="row" style={{ gap: 'var(--sp-8)', alignItems: 'flex-start' }}>
                <Pill tone="purple">{item.label}</Pill>
                <span>
                  <div className="t">{item.title}</div>
                  <div className="s">{item.detail}</div>
                </span>
              </span>
            </MobileRow>
          ))}
        </MobileList>
      </div>

      {state === 'denied' ? (
        // The one state the app cannot ask its way out of: the switch is in
        // the phone's settings, so this is the walkthrough "Show me how"
        // promised (auth.html, "Notifications blocked").
        <div className="steps" aria-label="Turn notifications back on">
          <div className="step">
            <Pill tone="cyan">1</Pill>
            <div>
              <div className="t">iPhone: Settings → Notifications → The Hospitality Company</div>
              <div className="s">Switch on Allow Notifications.</div>
            </div>
          </div>
          <div className="step">
            <Pill tone="cyan">2</Pill>
            <div>
              <div className="t">Android: Settings → Apps → The Hospitality Company</div>
              <div className="s">Notifications → Allow.</div>
            </div>
          </div>
          <div className="step">
            <Pill tone="cyan">3</Pill>
            <div>
              <div className="t">Then come back to this screen</div>
              <div className="s">The button below works again once the phone allows it.</div>
            </div>
          </div>
        </div>
      ) : null}

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
