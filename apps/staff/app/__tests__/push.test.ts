import { describe, expect, it } from 'vitest';
import { isIos, pushCopy, pushState, urlBase64ToUint8Array } from '../../lib/push';
import type { PushEnvironment } from '../../lib/push';

/**
 * Web Push's six states — §10.5.
 *
 * The one that matters most today is `unconfigured`: there are no VAPID
 * keys in this environment (docs/14 O3), and the rule is that the app says
 * so rather than reporting a subscription it never made.
 */
const env = (over: Partial<PushEnvironment> = {}): PushEnvironment => ({
  supported: true,
  standalone: true,
  ios: false,
  configured: true,
  permission: 'default',
  ...over,
});

describe('push state (§10.5)', () => {
  it('a browser with no Push API is unsupported, not "denied"', () => {
    expect(pushState(env({ supported: false, permission: 'denied' }))).toBe('unsupported');
  });

  it('iOS in a Safari tab must install first — the prompt there does nothing', () => {
    expect(pushState(env({ ios: true, standalone: false }))).toBe('needs-install');
  });

  it('iOS from the home screen behaves like any other browser', () => {
    expect(pushState(env({ ios: true, standalone: true }))).toBe('default');
  });

  it('a build with no VAPID key says so instead of pretending (docs/14 O3)', () => {
    expect(pushState(env({ configured: false }))).toBe('unconfigured');
    expect(pushCopy('unconfigured').actionable).toBe(false);
    expect(pushCopy('unconfigured').headline).toMatch(/not available/i);
  });

  it('a denial outranks a missing key: the worker sees the thing they can fix', () => {
    expect(pushState(env({ configured: false, permission: 'denied' }))).toBe('denied');
  });

  it('granted is granted', () => {
    expect(pushState(env({ permission: 'granted' }))).toBe('granted');
    expect(pushCopy('granted').actionable).toBe(false);
  });

  it('only the askable states offer a button', () => {
    expect(pushCopy('default').actionable).toBe(true);
    expect(pushCopy('needs-install').actionable).toBe(true);
    expect(pushCopy('denied').actionable).toBe(false);
    expect(pushCopy('unsupported').actionable).toBe(false);
  });
});

describe('platform detection', () => {
  it('an iPad reporting itself as a Mac is still an iPad', () => {
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isIos('Mozilla/5.0 (Linux; Android 14; Pixel 7)')).toBe(false);
  });
});

describe('VAPID key decoding', () => {
  it('reads URL-safe base64 with no padding, which is how the key ships', () => {
    // "hi" → "aGk=", URL-safe and unpadded: "aGk"
    expect(Array.from(urlBase64ToUint8Array('aGk'))).toEqual([104, 105]);
    expect(Array.from(urlBase64ToUint8Array('aGk='))).toEqual([104, 105]);
    // '-' and '_' are the URL-safe substitutions for '+' and '/'.
    expect(urlBase64ToUint8Array('-_8').length).toBe(2);
  });
});
