'use client';

import { useEffect } from 'react';
import { type BadgeNavigator, clearAppBadge } from '../../lib/app-badge';
import { registerServiceWorker } from '../../lib/push';

/**
 * Registers the service worker on every page — §10.5, ADR-0001.
 *
 * It lives in the root layout rather than in the app shell because the two
 * things it unlocks both happen OUTSIDE the signed-in screens: a browser
 * only offers to install a PWA once a service worker controls the page, and
 * the install screen is the first thing a new worker sees. A registration
 * that only ran after sign-in would make the app uninstallable at exactly
 * the moment it is meant to be installed.
 *
 * It also takes the red count off the home-screen icon (lib/app-badge.ts)
 * whenever the app is open in front of the worker — on launch, and each
 * time it comes back from the background — because that is when what the
 * pushes said has been seen.
 *
 * Renders nothing. `register()` is idempotent, and the failure path logs
 * once rather than breaking the page (docs/06: no SW means no offline shell
 * and no push, but the app itself still works).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void registerServiceWorker();

    const seen = () => {
      if (document.visibilityState !== 'visible') return;
      void clearAppBadge(
        navigator as BadgeNavigator,
        typeof caches === 'undefined' ? undefined : caches,
      );
    };
    seen();
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, []);
  return null;
}
