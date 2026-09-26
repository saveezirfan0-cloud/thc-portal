import { describe, expect, it } from 'vitest';
import { appOrigin, recoveryRedirect } from '../origin';

/**
 * Where an emailed reset link comes back to (audit D13, ADR-0039): the
 * app's own NEXT_PUBLIC_*_URL, nothing guessed in production.
 */
describe('appOrigin', () => {
  it('uses the explicit URL, trimmed and without trailing slashes', () => {
    expect(appOrigin(' https://staff.thc.example// ', 'http://127.0.0.1:3001', 'production')).toBe(
      'https://staff.thc.example',
    );
  });

  it('has no answer in production without it: never VERCEL_URL, never localhost', () => {
    expect(appOrigin(undefined, 'http://127.0.0.1:3001', 'production')).toBeNull();
    expect(appOrigin('   ', 'http://127.0.0.1:3001', 'production')).toBeNull();
  });

  it('falls back to the dev server only outside production', () => {
    expect(appOrigin(undefined, 'http://127.0.0.1:3001', 'development')).toBe(
      'http://127.0.0.1:3001',
    );
    expect(appOrigin(undefined, 'http://127.0.0.1:3002', 'test')).toBe('http://127.0.0.1:3002');
  });
});

describe('recoveryRedirect', () => {
  it('is the app’s /auth/confirm with no query of its own', () => {
    expect(recoveryRedirect('https://office.thc.example')).toBe(
      'https://office.thc.example/auth/confirm',
    );
    expect(recoveryRedirect('https://office.thc.example/')).toBe(
      'https://office.thc.example/auth/confirm',
    );
  });
});
