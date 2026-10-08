import { isIos } from '../../lib/push';
import type { PushState } from '../../lib/push';

/**
 * The push-health banner above every Staff App tab — what it says, whether
 * it can be put away, and for how long. Pure, so every case is a test
 * rather than a phone.
 *
 * Every banner is one short sentence and at most one action. The how-to
 * lives on /install and /notifications; the banner only says what is wrong
 * and points there. Two kinds, told apart by whether they can be put away:
 *
 *   A FAULT — push was working on this device and is not any more: iOS
 *   revoked the subscription (permission still "granted", no subscription
 *   behind it), or the worker switched notifications off after having them
 *   on. That is the silent failure that costs shifts, so it cannot be
 *   dismissed.
 *
 *   ADVICE — push has never worked here: an iPhone in a Safari tab, a
 *   browser with no Push API, a build without VAPID keys, a worker not yet
 *   asked, or one who said no. Accurate for their browser, and dismissible
 *   for seven days on this device.
 */

export type Browser = 'ios-safari' | 'ios-other' | 'android' | 'other';

/**
 * Chrome, Firefox, Edge, Opera, the Google app, and the in-app browsers
 * (Instagram, Facebook, TikTok…) on iOS. On iOS only Safari reliably offers
 * Add to Home Screen, so these are told to open the page in Safari.
 */
const IOS_OTHER =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|FBAN|FBAV|FB_IAB|Instagram|musical_ly|TikTok|Snapchat|LinkedInApp|Line\//i;

export function detectBrowser(userAgent: string, maxTouchPoints = 0): Browser {
  if (isIos(userAgent, maxTouchPoints)) {
    // An in-app WKWebView usually drops the "Safari/" token altogether.
    return /Safari\//i.test(userAgent) && !IOS_OTHER.test(userAgent) ? 'ios-safari' : 'ios-other';
  }
  if (/android/i.test(userAgent)) return 'android';
  return 'other';
}

export interface BannerInput {
  /** `pushState(readEnvironment())`. */
  state: PushState;
  /** Permission says granted but the subscription is gone (iOS revokes these). */
  lapsed: boolean;
  /** This device has held a working subscription before (`WAS_ON_KEY`). */
  wasOn: boolean;
  browser: Browser;
  /** Running from the home screen. */
  standalone: boolean;
  /**
   * ADR-0106: SpudBros Express staff are not offered shifts here, so the
   * banner talks about document requests, not shift alerts.
   */
  onboardingOnly?: boolean;
}

export type BannerTone = 'coral' | 'amber' | 'cyan';

export interface PushBanner {
  /** Stable per message: a dismissal only hides the message it was given for. */
  variant: string;
  tone: BannerTone;
  /** One short sentence. */
  text: string;
  link: { href: '/install' | '/notifications'; label: string } | null;
  dismissible: boolean;
}

type Message = Omit<PushBanner, 'dismissible'>;

const HOW_TO_INSTALL = { href: '/install', label: 'Show me' } as const;

/** Push worked here and has stopped: permission lapsed or was reset. */
const STOPPED: Message = {
  variant: 'stopped',
  tone: 'cyan',
  text: 'Notifications have stopped.',
  link: { href: '/notifications', label: 'Turn on' },
};

/** The same banners for a worker whose shifts are elsewhere (ADR-0106). */
const ONBOARDING_ONLY_TEXT: Readonly<Record<string, string>> = {
  'install:ios-safari': 'Add THC to your Home Screen to get alerts.',
  'install:ios-other': 'Open in Safari, then add THC to your Home Screen.',
  'unsupported:ios-old': 'Alerts need iOS 16.4 or later.',
  'unsupported:android': 'Open THC in Chrome to get alerts.',
  'unsupported:other': 'Alerts work on your phone, not in this browser.',
  unconfigured: 'Alerts aren’t set up yet — we’ll email you if a document needs another look.',
  denied: 'Notifications are off — you may miss a request to re-upload a document.',
  default: 'Turn on notifications so we can tell you if a document needs another look.',
};

/** What the banner says, or null when there is nothing to say. */
export function pushBanner(input: BannerInput): PushBanner | null {
  const { state, lapsed, wasOn, browser, standalone } = input;
  if (state === 'granted' && !lapsed) return null;

  const fault = lapsed || wasOn;
  const message =
    lapsed || (fault && state === 'default') ? STOPPED : messageFor(state, browser, standalone);
  if (!message) return null;
  const text = (input.onboardingOnly && ONBOARDING_ONLY_TEXT[message.variant]) || message.text;
  return {
    ...message,
    text,
    variant: fault ? `fault:${message.variant}` : message.variant,
    dismissible: !fault,
  };
}

/**
 * Coral is for the state the worker is losing shifts to and has chosen;
 * amber for `unconfigured`, which nobody on the phone can fix; cyan for an
 * instruction.
 */
function messageFor(state: PushState, browser: Browser, standalone: boolean): Message | null {
  switch (state) {
    case 'needs-install':
      return browser === 'ios-safari'
        ? {
            variant: 'install:ios-safari',
            tone: 'cyan',
            text: 'Add THC to your Home Screen to get shift alerts.',
            link: HOW_TO_INSTALL,
          }
        : {
            variant: 'install:ios-other',
            tone: 'cyan',
            text: 'Open in Safari, then add THC to your Home Screen.',
            link: HOW_TO_INSTALL,
          };

    case 'unsupported':
      if (standalone && (browser === 'ios-safari' || browser === 'ios-other')) {
        // Installed on an iPhone that still has no Push API: iOS before 16.4.
        return {
          variant: 'unsupported:ios-old',
          tone: 'cyan',
          text: 'Shift alerts need iOS 16.4 or later.',
          link: null,
        };
      }
      if (browser === 'android') {
        return {
          variant: 'unsupported:android',
          tone: 'cyan',
          text: 'Open THC in Chrome to get shift alerts.',
          link: HOW_TO_INSTALL,
        };
      }
      return {
        variant: 'unsupported:other',
        tone: 'cyan',
        text: 'Shift alerts work on your phone, not in this browser.',
        link: HOW_TO_INSTALL,
      };

    case 'unconfigured':
      return {
        variant: 'unconfigured',
        tone: 'amber',
        text: 'Shift alerts aren’t set up yet — check the app for new shifts.',
        link: null,
      };

    case 'denied':
      return {
        variant: 'denied',
        tone: 'coral',
        text: 'Notifications are off — you’ll miss shifts.',
        link: { href: '/notifications', label: 'Fix' },
      };

    case 'default':
      return {
        variant: 'default',
        tone: 'cyan',
        text: 'Turn on notifications so you don’t miss shifts.',
        link: { href: '/notifications', label: 'Turn on' },
      };

    default:
      return null;
  }
}

// ---------------------------------------------------------------------
// Dismissal, remembered per device
// ---------------------------------------------------------------------

export const DISMISS_KEY = 'thc.push-banner.dismissed';
/** Set once a working subscription has been seen on this device. */
export const WAS_ON_KEY = 'thc.push.was-on';
export const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export function dismissalRecord(variant: string, now: number): string {
  return JSON.stringify({ variant, at: now });
}

/**
 * Whether a stored dismissal still hides this banner: same message, within
 * seven days. Anything unreadable — a corrupt value, a clock that has gone
 * backwards — counts as not dismissed, so the failure mode is "shown".
 */
export function isDismissed(record: string | null, variant: string, now: number): boolean {
  if (!record) return false;
  try {
    const parsed = JSON.parse(record) as { variant?: unknown; at?: unknown };
    if (parsed.variant !== variant || typeof parsed.at !== 'number') return false;
    const age = now - parsed.at;
    return age >= 0 && age < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/** The banner to draw, after a dismissal has had its say. */
export function visibleBanner(
  input: BannerInput,
  record: string | null,
  now: number,
): PushBanner | null {
  const banner = pushBanner(input);
  if (!banner) return null;
  if (banner.dismissible && isDismissed(record, banner.variant, now)) return null;
  return banner;
}

/**
 * localStorage, every access guarded. Safari private mode, a disabled
 * storage setting or a sandboxed frame throw on the property read itself,
 * not only on `setItem`; none of that may take the page down with it.
 */
export function readStored(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    // Not remembered on this device; the in-memory state still hides it now.
  }
}
