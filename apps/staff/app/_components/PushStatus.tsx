'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  currentSubscription,
  pushState,
  readEnvironment,
  registerServiceWorker,
  serialise,
} from '../../lib/push';
import { savePushSubscription } from '../notifications/actions';
import {
  DISMISS_KEY,
  WAS_ON_KEY,
  detectBrowser,
  dismissalRecord,
  readStored,
  visibleBanner,
  writeStored,
} from './push-banner';
import type { BannerInput, PushBanner } from './push-banner';
import '../chrome.css';

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
 *   3. Say when notifications are NOT working. What it says and whether it
 *      can be put away is `push-banner.ts`: a fault (push was on here and
 *      has stopped) stays until it is fixed; advice for a browser that has
 *      never had push is one line, accurate for that browser, and can be
 *      dismissed for seven days.
 *
 * It renders nothing when everything is fine, and nothing on the server —
 * the state lives in the browser, so the first paint never guesses.
 * /notifications, whose whole body is this message, leaves it out
 * (`StaffShell pushStatus={false}`).
 */
export function PushStatus() {
  const [input, setInput] = useState<BannerInput | null>(null);
  const [record, setRecord] = useState<{ value: string | null; now: number } | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const env = readEnvironment();
      const base: BannerInput = {
        state: pushState(env),
        lapsed: false,
        wasOn: readStored(WAS_ON_KEY) === '1',
        browser: detectBrowser(navigator.userAgent, navigator.maxTouchPoints),
        standalone: env.standalone,
      };
      if (!cancelled) {
        setRecord({ value: readStored(DISMISS_KEY), now: Date.now() });
        setInput(base);
      }

      await registerServiceWorker();

      if (base.state === 'granted') {
        const subscription = await currentSubscription();
        // A permission that says "granted" with no subscription behind it
        // is the state iOS leaves behind when it revokes one. Shown as
        // "turn these back on" rather than as working — and as a fault,
        // because it was working.
        if (!subscription) {
          if (!cancelled) setInput({ ...base, lapsed: true });
          return;
        }
        writeStored(WAS_ON_KEY, '1');
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

  if (!input || !record || hidden) return null;
  const banner = visibleBanner(input, record.value, record.now);
  if (!banner) return null;

  const dismiss = () => {
    writeStored(DISMISS_KEY, dismissalRecord(banner.variant, Date.now()));
    setHidden(true);
  };

  return <PushBannerView banner={banner} onDismiss={banner.dismissible ? dismiss : null} />;
}

/** The compact banner. Exported for the markup tests. */
export function PushBannerView({
  banner,
  onDismiss,
}: {
  banner: PushBanner;
  onDismiss: (() => void) | null;
}) {
  return (
    <div className={`alert ${banner.tone} push-banner`} role="status">
      <p className="push-banner-text">
        <b>{banner.headline}</b> {banner.detail}
        {banner.link ? (
          <>
            {' '}
            <Link href={banner.link.href}>{banner.link.label}</Link>
          </>
        ) : null}
      </p>
      {onDismiss ? (
        <button
          type="button"
          className="push-banner-x"
          aria-label="Hide this for 7 days"
          onClick={onDismiss}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
