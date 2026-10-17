'use client';

import { useRef } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@thc/ui';
import type { SignOutProps } from '@thc/ui';
import { forgetThisDevice } from '../../lib/push';
import { forgetPushSubscription } from '../notifications/actions';
import { WAS_ON_KEY } from './push-banner';
import { SAVED_KEY } from './push-save-memo';

/**
 * Sign out, for the Staff App (§1.4) — `@thc/ui`'s `SignOut`, plus the one
 * thing a phone that receives pushes has to do on the way out (security
 * round 12.10, item 3).
 *
 * The same form POST to `/auth/signout` and the same markup (`.signout`,
 * `display: contents`; read SignOut.tsx for why it is a POST and not a
 * link). Before it is sent, this device's Web Push subscription is
 * forgotten by the record (`forget_push_subscription`, with the session
 * that owns it still alive) and unsubscribed in the browser
 * (`lib/push.ts` `forgetThisDevice`). Otherwise the signed-out worker's
 * shift reminders and invitations keep arriving on a phone they may have
 * handed on — or that was stolen — until someone else signs in on it.
 *
 * Best effort and never blocking: the clean-up is capped at 1.5 s and every
 * failure is swallowed; the form is submitted whatever happens. With no
 * JavaScript the plain POST still signs out.
 */
export function StaffSignOut({
  action = '/auth/signout',
  tone = 'ghost',
  size = 'sm',
  block,
  className,
  children = 'Sign out',
}: SignOutProps) {
  const leaving = useRef(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (leaving.current) return; // a second tap while the first is on its way
    leaving.current = true;
    const form = event.currentTarget;
    void (async () => {
      try {
        await forgetThisDevice(forgetPushSubscription);
        // A sign-out turned notifications off on purpose; the next person
        // on this phone is not shown "notifications have stopped".
        window.localStorage?.removeItem(WAS_ON_KEY);
        // And the record no longer holds this device: whoever signs in next,
        // the same worker included, sends it again.
        window.localStorage?.removeItem(SAVED_KEY);
      } catch {
        // Never in the way of signing out.
      } finally {
        form.submit();
      }
    })();
  }

  return (
    <form method="post" action={action} className="signout" onSubmit={onSubmit}>
      <Button
        type="submit"
        tone={tone}
        size={size}
        {...(block ? { block: true } : {})}
        {...(className ? { className } : {})}
      >
        {children}
      </Button>
    </form>
  );
}
