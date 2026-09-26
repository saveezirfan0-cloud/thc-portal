/**
 * Web Push in the Staff App — Scope §10.5, §8, ADR-0001 (docs/06).
 *
 * Every time-critical thing THC tells a worker is a push: the invitation
 * (N5), the 12:00 "I'm ready" deadline that costs them the shift if they
 * miss it (N6/N6b), check-in and check-out (N9/N9b), and the document
 * expiry ladder that blocks them (N1–N4). A worker with no push is a
 * worker who misses shifts, so the state of the subscription is treated
 * here as a visible product state rather than a background detail.
 *
 * Six states, and the app says which one it is in rather than showing a
 * button that does nothing:
 *
 *   unsupported   this browser has no Push API at all
 *   needs-install iOS, opened in Safari rather than from the home screen.
 *                 iOS 16.4+ only delivers Web Push to an INSTALLED PWA,
 *                 so the install screen comes first (§10.5, docs/06)
 *   unconfigured  the build carries no VAPID public key. True today: the
 *                 key pair does not exist yet (docs/14 O3). Everything
 *                 else here works; the app says so out loud instead of
 *                 reporting a subscription it never made
 *   default       supported, not yet asked. Asking is a user gesture
 *   denied        the worker (or the OS) said no — the one state the app
 *                 cannot fix, so it explains where the switch lives
 *   granted       subscribed; the endpoint is on the worker's record
 *
 * The decision is a pure function of five inputs so it can be tested
 * without a browser; everything below it is the small amount of real
 * plumbing that talks to `navigator`.
 */

export type PushState =
  'unsupported' | 'needs-install' | 'unconfigured' | 'default' | 'denied' | 'granted';

export interface PushEnvironment {
  /** `serviceWorker` and `PushManager` both present. */
  supported: boolean;
  /** Running from the home screen rather than a browser tab. */
  standalone: boolean;
  /** iOS or iPadOS, where installation is a hard precondition. */
  ios: boolean;
  /** This build has a VAPID public key. */
  configured: boolean;
  permission: NotificationPermission;
}

/**
 * Which state the app is in. Ordered by what blocks what: a browser that
 * cannot do push at all is not "denied", and an iPhone in a Safari tab is
 * not "default" — the permission prompt there produces nothing.
 *
 * iOS-in-a-tab comes FIRST, before the feature test. Safari only exposes
 * `PushManager` to an installed web app, so a Safari tab reports
 * `supported: false` — and with the feature test first, every iPhone
 * worker who had not installed yet was told "This browser cannot show
 * notifications. Open the app in Safari…" while standing in Safari. The
 * truth for them is "install first", whatever the tab exposes.
 */
export function pushState(env: PushEnvironment): PushState {
  if (env.ios && !env.standalone) return 'needs-install';
  if (!env.supported) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  if (!env.configured) return 'unconfigured';
  if (env.permission === 'granted') return 'granted';
  return 'default';
}

export interface PushCopy {
  /** Short line for the banner in the app chrome. */
  headline: string;
  /** What the worker can do about it, in their own terms. */
  detail: string;
  /** Whether a "Turn on notifications" button can do anything at all. */
  actionable: boolean;
  /**
   * Where "Show me how" goes, when there is somewhere to go. Separate from
   * `actionable`: a denied permission cannot be asked for again, but the
   * worker can still be walked through their phone's settings (auth.html,
   * "Notifications blocked").
   */
  link?: '/notifications' | '/install';
}

/**
 * The copy for each state. It lives next to the decision because the two
 * drift apart the moment they are in different files, and because a
 * notification state a worker cannot understand is the same as no state.
 */
export function pushCopy(state: PushState): PushCopy {
  switch (state) {
    case 'granted':
      return {
        headline: 'Notifications are on.',
        detail: 'Invitations, the 12:00 reminder and check-in alerts reach this device.',
        actionable: false,
      };
    case 'default':
      return {
        headline: 'Turn on notifications.',
        detail:
          'Shift invitations, the 12:00 “I’m ready” reminder and check-in alerts are notifications — without them you will miss shifts.',
        actionable: true,
        link: '/notifications',
      };
    case 'denied':
      return {
        headline: 'Notifications are off.',
        detail:
          'You won’t get shift invitations, the 12:00 “I’m ready” reminder or check-in reminders. Settings → Notifications → The Hospitality Company → Allow.',
        actionable: false,
        link: '/notifications',
      };
    case 'needs-install':
      return {
        headline: 'Add the app to your home screen first.',
        detail:
          'On iPhone, notifications only work from the installed app, not from a Safari tab. It takes three taps.',
        actionable: true,
        link: '/install',
      };
    case 'unconfigured':
      return {
        headline: 'Notifications are not available yet.',
        detail:
          'This version of the app cannot send them — the office is setting them up. Until then, check the app for new shifts and confirmations; nothing else changes.',
        actionable: false,
      };
    case 'unsupported':
    default:
      return {
        headline: 'This browser cannot show notifications.',
        detail:
          'Open the app in Safari on iPhone or Chrome on Android and add it to your home screen.',
        actionable: false,
      };
  }
}

/** The VAPID public key, inlined at build time. Absent today (docs/14 O3). */
export function vapidPublicKey(): string | null {
  const key = process.env['NEXT_PUBLIC_VAPID_PUBLIC_KEY'];
  return key && key.length > 0 ? key : null;
}

export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  // iPadOS 13+ reports itself as a Mac; the touch points are what give it
  // away, and getting this wrong means telling an iPad user to do nothing.
  return (
    /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true || iosStandalone === true
  );
}

/** Reads the live environment. Browser only. */
export function readEnvironment(): PushEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      supported: false,
      standalone: false,
      ios: false,
      configured: vapidPublicKey() !== null,
      permission: 'default',
    };
  }
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return {
    supported,
    standalone: isStandalone(),
    ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
    configured: vapidPublicKey() !== null,
    permission: supported ? Notification.permission : 'default',
  };
}

/** VAPID keys travel as URL-safe base64; `subscribe` wants the bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const normalised = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** What the server action needs. Never logged — an endpoint is a capability. */
export interface SerialisedSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  replaces?: string;
}

export function serialise(
  subscription: PushSubscription | PushSubscriptionJSON,
  userAgent: string,
  replaces?: string,
): SerialisedSubscription | null {
  const json = 'toJSON' in subscription ? subscription.toJSON() : subscription;
  const endpoint = json.endpoint;
  const p256dh = json.keys?.['p256dh'];
  const auth = json.keys?.['auth'];
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth, userAgent, ...(replaces ? { replaces } : {}) };
}

/** Registers the service worker. Idempotent; safe to call on every load. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (cause) {
    // A failed registration means no offline shell and no push. It is worth
    // one console line; it is not worth breaking the app the worker is
    // standing in front of.
    console.error('[push] service worker registration failed', cause);
    return null;
  }
}

export type EnableResult =
  | { ok: true; subscription: SerialisedSubscription }
  | { ok: false; state: PushState; message: string };

/**
 * Subscribe. MUST be called from a user gesture — Safari discards a
 * permission request that is not, and the worker is left with a prompt
 * that never appeared and a button that seems to do nothing (§10.5).
 *
 * Returns the subscription for the caller to persist through the server
 * action; this module never talks to the database itself, so the endpoint
 * crosses exactly one boundary.
 */
export async function enablePush(): Promise<EnableResult> {
  const env = readEnvironment();
  const state = pushState(env);
  if (state !== 'default' && state !== 'granted') {
    return { ok: false, state, message: pushCopy(state).headline };
  }

  const key = vapidPublicKey();
  if (!key) return { ok: false, state: 'unconfigured', message: pushCopy('unconfigured').headline };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, state: 'denied', message: pushCopy('denied').headline };
  }

  const registration =
    (await navigator.serviceWorker.getRegistration('/')) ?? (await registerServiceWorker());
  if (!registration) {
    return {
      ok: false,
      state: 'unsupported',
      message: 'The app could not start its background worker on this device.',
    };
  }
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }));

  const serialised = serialise(subscription, navigator.userAgent);
  if (!serialised) {
    return {
      ok: false,
      state: 'default',
      message: 'The browser returned a subscription the app could not read.',
    };
  }
  return { ok: true, subscription: serialised };
}

/**
 * The reconciliation every launch does: if this device already holds a
 * subscription, make sure the record still knows about it. This is the
 * half that repairs a `pushsubscriptionchange` that happened while the app
 * was closed — iOS has no Background Sync, so "on next open" is the only
 * moment that exists (§10.5).
 */
export async function currentSubscription(): Promise<SerialisedSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  return serialise(subscription, navigator.userAgent);
}
