'use client';

import { useEffect } from 'react';
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
 * Renders nothing. `register()` is idempotent, and the failure path logs
 * once rather than breaking the page (docs/06: no SW means no offline shell
 * and no push, but the app itself still works).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}
