import { describe, expect, it } from 'vitest';
import { HOME_PATH, ROLES, WRONG_APP_PATH, wrongAppCopy, wrongAppRole } from '../roles';

/**
 * The wrong-app page (ADR-0138): each app renders it as its own sign-in
 * card at WRONG_APP_PATH, the middleware rewriting a refused session there.
 * The sign-out control is `WrongApp` in @thc/ui (a POST, pinned there).
 */
describe('wrongAppCopy', () => {
  it('names the app that refused the session, and the role that was held', () => {
    expect(wrongAppCopy('client', 'Staff App')).toEqual({
      title: 'This account is not for the Staff App',
      body: 'You are signed in to a Client Portal account. Sign out and use the account for this app.',
    });
    expect(wrongAppCopy('admin', 'Client Portal').body).toContain('a Back Office account');
    expect(wrongAppCopy('staff', 'Back Office').body).toContain('a Staff account');
  });

  it('still says what to do when the session carries no role at all', () => {
    expect(wrongAppCopy(null, 'Back Office').body).toBe(
      'Your account has no role set, so it cannot be admitted to any app. Sign out and use the account for this app.',
    );
  });

  it('reads only a real role off the rewritten request', () => {
    expect(wrongAppRole('client')).toBe('client');
    expect(wrongAppRole('none')).toBeNull();
    expect(wrongAppRole(null)).toBeNull();
    expect(wrongAppRole('<script>')).toBeNull();
  });

  it('is a path in the app itself, never a redirect target elsewhere', () => {
    expect(WRONG_APP_PATH).toBe('/wrong-app');
  });
});

describe('HOME_PATH', () => {
  // Every app's `/` redirects to its home. A home of `/` is a page that
  // redirects to itself: the Staff App shipped that and looped until Safari
  // gave up after 20 redirections.
  it.each(ROLES)('never sends %s to the root that redirects to it', (role) => {
    expect(HOME_PATH[role]).not.toBe('/');
    expect(HOME_PATH[role]).toMatch(/^\/[a-z]/);
  });

  it('lands each role on the first screen of its app', () => {
    expect(HOME_PATH).toEqual({ admin: '/dashboard', client: '/client', staff: '/shifts' });
  });
});
