import { describe, expect, it } from 'vitest';
import { RESEND_COOLDOWN_SECONDS, formatCountdown, mailAppHref } from '../sent/resend';

/** A2's two controls (wireframes/staff/auth.html): the countdown and where "Open mail app" goes. */
describe('formatCountdown', () => {
  it('prints m:ss as the wireframe does ("Resend in 0:48")', () => {
    expect(formatCountdown(48)).toBe('0:48');
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('never goes negative or fractional', () => {
    expect(formatCountdown(-3)).toBe('0:00');
    expect(formatCountdown(12.9)).toBe('0:12');
  });

  it('starts from a one-minute cooldown', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(formatCountdown(RESEND_COOLDOWN_SECONDS)).toBe('1:00');
  });
});

describe('mailAppHref', () => {
  it('opens Mail on iOS', () => {
    expect(mailAppHref('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(
      'message://',
    );
    expect(mailAppHref('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('message://');
  });

  it('opens the default mail client on Android through an APP_EMAIL intent', () => {
    expect(mailAppHref('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0')).toBe(
      'intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_EMAIL;end',
    );
  });

  it('has nowhere to go on a desktop or with no User-Agent, and never falls back to mailto:', () => {
    expect(mailAppHref('Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0')).toBeNull();
    expect(mailAppHref('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBeNull();
    expect(mailAppHref(null)).toBeNull();
    expect(mailAppHref(undefined)).toBeNull();
  });
});
