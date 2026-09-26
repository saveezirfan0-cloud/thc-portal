import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushState } from '../../../lib/push';
import {
  DISMISS_FOR_MS,
  detectBrowser,
  dismissalRecord,
  isDismissed,
  pushBanner,
  readStored,
  visibleBanner,
  writeStored,
} from '../push-banner';
import type { BannerInput } from '../push-banner';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../../notifications/actions', () => ({ savePushSubscription: vi.fn() }));

const { PushBannerView } = await import('../PushStatus');

/**
 * The push banner above every tab (§10.5). The bug this pins: an iPhone in
 * Safari was told "This browser cannot show notifications. Open the app in
 * Safari…" — because a Safari tab has no PushManager, so the feature test
 * answered first — in a banner that could not be put away.
 */

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91',
  ipadAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
};

const input = (over: Partial<BannerInput> = {}): BannerInput => ({
  state: 'default',
  lapsed: false,
  wasOn: false,
  browser: 'android',
  standalone: false,
  ...over,
});

describe('which browser is this', () => {
  it('tells Safari on iPhone from the other iOS browsers and in-app views', () => {
    expect(detectBrowser(UA.iphoneSafari)).toBe('ios-safari');
    expect(detectBrowser(UA.iphoneChrome)).toBe('ios-other');
    expect(detectBrowser(UA.iphoneInstagram)).toBe('ios-other');
    expect(detectBrowser(UA.ipadAsMac, 5)).toBe('ios-safari');
    expect(detectBrowser(UA.android)).toBe('android');
    expect(detectBrowser(UA.desktopFirefox)).toBe('other');
    expect(detectBrowser(UA.ipadAsMac, 0)).toBe('other');
  });
});

describe('iPhone in a Safari tab (the reported bug)', () => {
  it('is needs-install even though the tab exposes no Push API', () => {
    const state = pushState({
      supported: false,
      standalone: false,
      ios: true,
      configured: true,
      permission: 'default',
    });
    expect(state).toBe('needs-install');
  });

  it('says Add to Home Screen, links to /install and never says "open in Safari"', () => {
    const banner = pushBanner(input({ state: 'needs-install', browser: 'ios-safari' }));
    expect(banner).toMatchObject({
      tone: 'cyan',
      headline: 'Add THC to your Home Screen to get shift alerts:',
      detail: 'tap Share, then Add to Home Screen.',
      link: { href: '/install' },
      dismissible: true,
    });
    expect(`${banner?.headline} ${banner?.detail}`).not.toMatch(
      /cannot show|Open the app in Safari/,
    );
  });

  it('sends Chrome and in-app browsers on iPhone to Safari first', () => {
    const banner = pushBanner(input({ state: 'needs-install', browser: 'ios-other' }));
    expect(banner?.detail).toMatch(/open this page in Safari/);
    expect(banner?.link?.href).toBe('/install');
  });
});

describe('other browsers get copy that is true for them', () => {
  it('Android without push: open in Chrome', () => {
    const banner = pushBanner(input({ state: 'unsupported', browser: 'android' }));
    expect(banner?.detail).toMatch(/Chrome/);
    expect(banner?.detail).not.toMatch(/Safari/);
  });

  it('an installed iPhone with no Push API: update iOS', () => {
    const banner = pushBanner(
      input({ state: 'unsupported', browser: 'ios-other', standalone: true }),
    );
    expect(banner?.headline).toMatch(/iOS 16\.4/);
  });

  it('a desktop browser: alerts work on the phone', () => {
    const banner = pushBanner(input({ state: 'unsupported', browser: 'other' }));
    expect(banner?.detail).toMatch(/Safari on iPhone or Chrome on Android/);
  });

  it('says nothing when notifications work', () => {
    expect(pushBanner(input({ state: 'granted' }))).toBeNull();
  });
});

describe('advice can be put away; a fault cannot', () => {
  it('every never-worked state is dismissible', () => {
    for (const state of [
      'needs-install',
      'unsupported',
      'unconfigured',
      'default',
      'denied',
    ] as const) {
      expect(pushBanner(input({ state }))?.dismissible).toBe(true);
    }
  });

  it('a subscription iOS revoked (granted, none behind it) keeps the old banner, undismissible', () => {
    const banner = pushBanner(input({ state: 'granted', lapsed: true }));
    expect(banner).toMatchObject({
      variant: 'fault:default',
      tone: 'cyan',
      headline: 'Turn on notifications.',
      link: { href: '/notifications', label: 'Show me how' },
      dismissible: false,
    });
  });

  it('notifications switched off after being on here: the old coral banner, undismissible', () => {
    const banner = pushBanner(input({ state: 'denied', wasOn: true }));
    expect(banner).toMatchObject({ tone: 'coral', dismissible: false });
    expect(banner?.detail).toContain('Settings → Notifications → The Hospitality Company → Allow.');
  });

  it('a stored dismissal never hides a fault', () => {
    const now = Date.UTC(2026, 8, 25);
    const fault = input({ state: 'denied', wasOn: true });
    const record = dismissalRecord('fault:denied', now);
    expect(visibleBanner(fault, record, now)).not.toBeNull();
  });
});

describe('dismissal lasts seven days, for the message it was given for', () => {
  const now = Date.UTC(2026, 8, 25, 12);

  it('hides the same banner inside seven days and shows it again after', () => {
    const advice = input({ state: 'unconfigured' });
    const record = dismissalRecord('unconfigured', now);
    expect(visibleBanner(advice, record, now + DISMISS_FOR_MS - 1)).toBeNull();
    expect(visibleBanner(advice, record, now + DISMISS_FOR_MS)).not.toBeNull();
  });

  it('does not hide a different message', () => {
    const record = dismissalRecord('unconfigured', now);
    expect(visibleBanner(input({ state: 'default' }), record, now)).not.toBeNull();
  });

  it('treats junk and a clock that went backwards as not dismissed', () => {
    expect(isDismissed('not json', 'default', now)).toBe(false);
    expect(isDismissed('{"variant":"default"}', 'default', now)).toBe(false);
    expect(isDismissed(dismissalRecord('default', now + 60_000), 'default', now)).toBe(false);
    expect(isDismissed(null, 'default', now)).toBe(false);
  });
});

describe('storage that throws', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads as nothing and writes as a no-op, never an exception', () => {
    const throwing = {
      get localStorage(): Storage {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    vi.stubGlobal('window', throwing);
    expect(readStored('k')).toBeNull();
    expect(() => writeStored('k', 'v')).not.toThrow();
  });

  it('with no window at all (the server render)', () => {
    vi.stubGlobal('window', undefined);
    expect(readStored('k')).toBeNull();
    expect(() => writeStored('k', 'v')).not.toThrow();
  });
});

describe('the banner markup', () => {
  it('is one compact line with a labelled 44px dismiss button for advice', () => {
    const banner = pushBanner(input({ state: 'needs-install', browser: 'ios-safari' }));
    const html = renderToStaticMarkup(<PushBannerView banner={banner!} onDismiss={() => {}} />);
    expect(html).toContain('class="alert cyan push-banner"');
    expect(html).toContain('href="/install"');
    expect(html).toContain('aria-label="Hide this for 7 days"');
  });

  it('has no dismiss button for a fault', () => {
    const banner = pushBanner(input({ state: 'denied', wasOn: true }));
    const html = renderToStaticMarkup(<PushBannerView banner={banner!} onDismiss={null} />);
    expect(html).not.toContain('<button');
  });
});
