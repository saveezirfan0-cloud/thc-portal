import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSameOrigin, staffUrlIsOffice } from '../staffUrl';

/**
 * NEXT_PUBLIC_STAFF_URL must be the Staff App, never the Back Office (it was
 * the Back Office's own address from 13.10.2026 for five days).
 */
describe('isSameOrigin', () => {
  it('ignores case, a trailing slash and a path', () => {
    expect(isSameOrigin('HTTPS://Office.example.com///', 'https://office.example.com')).toBe(true);
    expect(isSameOrigin('https://office.example.com/login', 'https://office.example.com/')).toBe(
      true,
    );
  });

  it('a different port, scheme or host is a different origin', () => {
    expect(isSameOrigin('https://office.example.com:8443', 'https://office.example.com')).toBe(
      false,
    );
    expect(isSameOrigin('http://office.example.com', 'https://office.example.com')).toBe(false);
    expect(isSameOrigin('https://staff.example.com', 'https://office.example.com')).toBe(false);
  });

  it('nothing to compare with, or not an address, is never "the same"', () => {
    expect(isSameOrigin('https://office.example.com', undefined)).toBe(false);
    expect(isSameOrigin('https://office.example.com', '  ')).toBe(false);
    expect(isSameOrigin('not a url', 'not a url')).toBe(false);
  });
});

describe('staffUrlIsOffice', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is true, and logged, when the Staff App address is the office', () => {
    expect(
      staffUrlIsOffice({
        NEXT_PUBLIC_STAFF_URL: 'https://office.example.com/',
        NEXT_PUBLIC_OFFICE_URL: 'https://office.example.com',
      }),
    ).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('is false for a real Staff App address', () => {
    expect(
      staffUrlIsOffice({
        NEXT_PUBLIC_STAFF_URL: 'https://staff.example.com',
        NEXT_PUBLIC_OFFICE_URL: 'https://office.example.com',
      }),
    ).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('is inert, by design, when either address is unset', () => {
    expect(staffUrlIsOffice({ NEXT_PUBLIC_STAFF_URL: 'https://office.example.com' })).toBe(false);
    expect(staffUrlIsOffice({ NEXT_PUBLIC_OFFICE_URL: 'https://office.example.com' })).toBe(false);
    expect(staffUrlIsOffice({})).toBe(false);
  });
});
