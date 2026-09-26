import { isIos, pushCopy } from '../../lib/push';
import type { PushState } from '../../lib/push';

/**
 * The push-health banner above every Staff App tab — what it says, whether
 * it can be put away, and for how long. Pure, so every case is a test
 * rather than a phone.
 *
 * Two kinds of banner, and they are not treated alike:
 *
 *   A FAULT — push was working on this device and is not any more: iOS
 *   revoked the subscription (permission still "granted", no subscription
 *   behind it), or the worker switched notifications off after having them
 *   on. That is the silent failure that costs shifts, so it keeps the
 *   original wording and tone and cannot be dismissed.
 *
 *   ADVICE — push has never worked here: an iPhone in a Safari tab, a
 *   browser with no Push API, a build without VAPID keys, a worker not yet
 *   asked, or one who said no. Accurate for their browser, one compact line,
 *   and dismissible for seven days on this device. It used to fill a fifth
 *   of every screen with advice that was wrong for the phone it was on.
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
}

export type BannerTone = 'coral' | 'amber' | 'cyan';

export interface PushBanner {
  /** Stable per message: a dismissal only hides the message it was given for. */
  variant: string;
  tone: BannerTone;
  headline: string;
  detail: string;
  link: { href: '/install' | '/notifications'; label: string } | null;
  dismissible: boolean;
}

/** What the banner says, or null when there is nothing to say. */
export function pushBanner(input: BannerInput): PushBanner | null {
  const { state, lapsed, wasOn, browser, standalone } = input;
  if (state === 'granted' && !lapsed) return null;

  if (lapsed || wasOn) {
    // Unchanged from before this file existed: the same words and tone as
    // PushStatus always showed, and no way to put it away.
    const shown: PushState = lapsed ? 'default' : state;
    const copy = pushCopy(shown);
    return {
      variant: `fault:${shown}`,
      tone: faultTone(shown),
      headline: copy.headline,
      detail: copy.detail,
      link: copy.link ? { href: copy.link, label: 'Show me how' } : null,
      dismissible: false,
    };
  }

  const advice = adviceFor(state, browser, standalone);
  return advice ? { ...advice, dismissible: true } : null;
}

/**
 * Coral is for the state the worker is losing shifts to and can fix, or has
 * chosen; `unconfigured` is neither (nobody in the company has push yet,
 * docs/14 O3) and the install step is an instruction, not a fault.
 */
function faultTone(state: PushState): BannerTone {
  return state === 'denied' ? 'coral' : state === 'unconfigured' ? 'amber' : 'cyan';
}

function adviceFor(
  state: PushState,
  browser: Browser,
  standalone: boolean,
): Omit<PushBanner, 'dismissible'> | null {
  switch (state) {
    case 'needs-install':
      return browser === 'ios-safari'
        ? {
            variant: 'install:ios-safari',
            tone: 'cyan',
            headline: 'Add THC to your Home Screen to get shift alerts:',
            detail: 'tap Share, then Add to Home Screen.',
            link: { href: '/install', label: 'Show me how' },
          }
        : {
            variant: 'install:ios-other',
            tone: 'cyan',
            headline: 'Shift alerts need the app on your Home Screen:',
            detail: 'open this page in Safari, tap Share, then Add to Home Screen.',
            link: { href: '/install', label: 'Show me how' },
          };

    case 'unsupported':
      if (standalone && (browser === 'ios-safari' || browser === 'ios-other')) {
        // Installed on an iPhone that still has no Push API: iOS before 16.4.
        return {
          variant: 'unsupported:ios-old',
          tone: 'cyan',
          headline: 'Shift alerts need iOS 16.4 or later:',
          detail: 'update in Settings → General → Software Update.',
          link: null,
        };
      }
      if (browser === 'android') {
        return {
          variant: 'unsupported:android',
          tone: 'cyan',
          headline: 'This browser can’t show shift alerts:',
          detail: 'open THC in Chrome and add it to your home screen.',
          link: { href: '/install', label: 'Show me how' },
        };
      }
      return {
        variant: 'unsupported:other',
        tone: 'cyan',
        headline: 'This browser can’t show shift alerts.',
        detail:
          'They work on your phone: Safari on iPhone or Chrome on Android, added to the home screen.',
        link: { href: '/install', label: 'Show me how' },
      };

    case 'unconfigured':
      return {
        variant: 'unconfigured',
        tone: 'amber',
        headline: 'Notifications aren’t available yet.',
        detail: 'The office is setting them up — check the app for new shifts until then.',
        link: null,
      };

    case 'denied':
      return {
        variant: 'denied',
        tone: 'coral',
        headline: 'Notifications are off.',
        detail: 'You’ll miss shift invitations and the 12:00 reminder.',
        link: { href: '/notifications', label: 'Show me how' },
      };

    case 'default':
      return {
        variant: 'default',
        tone: 'cyan',
        headline: 'Turn on notifications',
        detail: 'so you don’t miss shift invitations and the 12:00 reminder.',
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
