import { describe, expect, it } from 'vitest';
import { appOrigin, recoveryRedirect, staffAppOrigin } from '../origin';

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

/**
 * STAFF_APP_URL as a person types it (ADR-0122): on 13.10.2026 it was set
 * without https://, and every activation and apply link was refused.
 */
describe('staffAppOrigin', () => {
  it('reads a bare host as https', () => {
    expect(staffAppOrigin('staff.thehospitalitycompany.co.uk')).toBe(
      'https://staff.thehospitalitycompany.co.uk',
    );
    expect(staffAppOrigin('  staff.thehospitalitycompany.co.uk/  ')).toBe(
      'https://staff.thehospitalitycompany.co.uk',
    );
  });

  it('keeps a full origin, and drops a path, query or trailing slash', () => {
    expect(staffAppOrigin('https://thc-portal-staff-two.vercel.app')).toBe(
      'https://thc-portal-staff-two.vercel.app',
    );
    expect(staffAppOrigin('https://staff.thehospitalitycompany.co.uk/apply?x=1')).toBe(
      'https://staff.thehospitalitycompany.co.uk',
    );
    expect(staffAppOrigin('http://localhost:3001/')).toBe('http://localhost:3001');
  });

  it('has no answer for nothing, or for something that is not a web address', () => {
    expect(staffAppOrigin(undefined)).toBeNull();
    expect(staffAppOrigin('   ')).toBeNull();
    expect(staffAppOrigin('javascript:alert(1)')).toBeNull();
    expect(staffAppOrigin('ftp://staff.thc.example')).toBeNull();
    expect(staffAppOrigin('https://user:pass@staff.thc.example')).toBeNull();
    expect(staffAppOrigin('not a url')).toBeNull();
  });
});
