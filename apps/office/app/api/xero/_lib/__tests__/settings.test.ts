import { describe, expect, it } from 'vitest';
import { xeroEnv, authorizeUrl } from '../config';
import { DEFAULT_XERO_SETTINGS, mergeXero, readXeroSettings, validateXero } from '../settings';

describe('settings.xero', () => {
  it('defaults every value, falling back on a bad one', () => {
    expect(readXeroSettings(null)).toEqual(DEFAULT_XERO_SETTINGS);
    expect(readXeroSettings({ invoice_status: 'PAID', from_number: -1, enabled: 'yes' })).toEqual(
      DEFAULT_XERO_SETTINGS,
    );
    expect(
      readXeroSettings({ enabled: true, invoice_status: 'AUTHORISED', from_number: 4100 }),
    ).toMatchObject({
      enabled: true,
      invoice_status: 'AUTHORISED',
      from_number: 4100,
    });
  });

  it('refuses what Xero would refuse', () => {
    const ok = DEFAULT_XERO_SETTINGS;
    expect(validateXero(ok)).toBeNull();
    expect(validateXero({ ...ok, from_number: 0 })).toMatch(/invoice number/);
    expect(validateXero({ ...ok, from_number: Number.NaN })).toMatch(/invoice number/);
    expect(validateXero({ ...ok, invoice_status: 'PAID' as never })).toMatch(/Draft/);
    expect(validateXero({ ...ok, sales_account_code: '' })).toMatch(/account code/);
    expect(validateXero({ ...ok, sales_account_code: 'x'.repeat(11) })).toMatch(/account code/);
    expect(validateXero({ ...ok, tax_type: 'OUT PUT' })).toMatch(/tax type/);
  });

  it('keeps keys it does not edit when it merges', () => {
    expect(
      mergeXero({ other: 1, enabled: false }, { ...DEFAULT_XERO_SETTINGS, enabled: true }),
    ).toMatchObject({
      other: 1,
      enabled: true,
      invoice_status: 'DRAFT',
    });
  });
});

describe('Xero env', () => {
  it('is off unless all three variables are set', () => {
    expect(xeroEnv({})).toBeNull();
    expect(xeroEnv({ XERO_CLIENT_ID: 'a', XERO_CLIENT_SECRET: 'b' })).toBeNull();
    const env = xeroEnv({
      XERO_CLIENT_ID: 'a',
      XERO_CLIENT_SECRET: 'b',
      XERO_REDIRECT_URI: 'https://o/api/xero/callback',
    });
    expect(env?.scopes).toBe(
      'offline_access accounting.invoices accounting.contacts accounting.attachments',
    );
  });

  it('builds the consent URL with state and the redirect', () => {
    const env = xeroEnv({
      XERO_CLIENT_ID: 'a',
      XERO_CLIENT_SECRET: 'b',
      XERO_REDIRECT_URI: 'https://o/api/xero/callback',
    })!;
    const url = new URL(authorizeUrl(env, 'st4te'));
    expect(url.origin + url.pathname).toBe('https://login.xero.com/identity/connect/authorize');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('https://o/api/xero/callback');
  });
});
