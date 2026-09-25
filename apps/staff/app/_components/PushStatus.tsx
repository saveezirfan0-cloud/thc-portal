'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@thc/ui';
import {
  currentSubscription,
  pushCopy,
  pushState,
  readEnvironment,
  registerServiceWorker,
  serialise,
} from '../../lib/push';
import type { PushState } from '../../lib/push';
import { savePushSubscription } from '../notifications/actions';

/**
 * The push subscription's health, made visible — §10.5, §8.
 *
 * Three jobs, all of which have to happen on a page the worker actually
 * opens rather than on a settings screen they never will:
 *
 *   1. Register the service worker (offline shell + push delivery).
 *   2. Reconcile the subscription. If this device already holds one, tell
 *      the record about it again. That is what repairs a
 *      `pushsubscriptionchange` that fired while the app was closed — iOS
 *      has no Background Sync, so "next open" is the only moment there is.
 *   3. Say, out loud and persistently, when notifications are NOT working.
 *      The wireframe (staff/auth.html) puts a coral banner at the top of
 *      the app for exactly this, because a silent failure here looks
 *      identical to a quiet week and costs the worker shifts.
 *
 * It renders nothing when everything is fine. /notifications, whose whole
 * body is this message, leaves it out (`StaffShell pushStatus={false}`):
 * a banner saying "Show me how" would point at the page it is on.
 */
export function PushStatus() {
  const [state, setState] = useState<PushState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const current = pushState(readEnvironment());
      if (!cancelled) setState(current);

      await registerServiceWorker();

      if (current === 'granted') {
        const subscription = await currentSubscription();
        // A permission that says "granted" with no subscription behind it
        // is the state iOS leaves behind when it revokes one. Show it as
        // "turn these back on" rather than as working.
        if (!subscription) {
          if (!cancelled) setState('default');
          return;
        }
        await savePushSubscription(subscription);
      }
    };

    void sync();

    // The SW re-subscribes on rotation and posts the new endpoint here,
    // because it has no Supabase session of its own (§10.5).
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; subscription?: PushSubscriptionJSON; oldEndpoint?: string | null }
        | undefined;
      if (data?.type !== 'push-subscription-changed' || !data.subscription) return;
      const serialised = serialise(
        data.subscription,
        navigator.userAgent,
        data.oldEndpoint ?? undefined,
      );
      if (serialised) void savePushSubscription(serialised);
    };

    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, []);

  if (state === null || state === 'granted') return null;

  const copy = pushCopy(state);
  // Coral is for the state the worker is losing shifts to and CAN fix, or
  // has chosen. `unconfigured` is neither — nobody in the company has push
  // yet (docs/14 O3) — and `needs-install` is an instruction, not a fault.
  // Colouring all three alike would train workers to ignore the one that
  // matters.
  const tone = state === 'denied' ? 'coral' : state === 'unconfigured' ? 'amber' : 'cyan';
  return (
    <Alert tone={tone}>
      <b>{copy.headline}</b>
      <br />
      <span className="xs">
        {copy.detail} {copy.link ? <Link href={copy.link}>Show me how</Link> : null}
      </span>
    </Alert>
  );
}
