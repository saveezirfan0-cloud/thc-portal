import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mapProviderResponse, providerConfig } from '../provider.config';
import { createProviderChecker } from '../provider';

/**
 * The provider adapter against SYNTHETIC responses (fixtures/README.md):
 * what it sends, and how it reads each kind of answer. The mapping is an
 * assumption (ADR-0025) — these pin it, they do not prove it.
 */
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')) as unknown;
const AT = '2026-09-25T07:00:00.000Z';
const INPUT = {
  shareCode: 'W123AB4CD',
  dateOfBirth: '2002-02-12',
  companyName: 'The Hospitality Company',
};
const ENV: Record<string, string> = {
  RTW_PROVIDER_URL: 'https://provider.example/v1/checks',
  RTW_PROVIDER_API_KEY: 'synthetic-key',
};
const env = (vars: Record<string, string>) => (name: string) => vars[name];

function reply(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('configuration', () => {
  it('is unavailable without both the URL and the key', () => {
    expect(createProviderChecker(env({}))).toBeNull();
    expect(createProviderChecker(env({ RTW_PROVIDER_URL: 'https://x' }))).toBeNull();
    expect(createProviderChecker(env(ENV))).not.toBeNull();
  });

  it('defaults to a Bearer Authorization header, and honours an empty prefix', () => {
    expect(providerConfig(env(ENV))).toMatchObject({
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
    });
    expect(
      providerConfig(
        env({ ...ENV, RTW_PROVIDER_AUTH_HEADER: 'x-api-key', RTW_PROVIDER_AUTH_PREFIX: '' }),
      ),
    ).toMatchObject({ authHeader: 'x-api-key', authPrefix: '' });
  });
});

describe('the request', () => {
  it('POSTs the code, the date of birth and the company name, with the key', async () => {
    const fetchImpl = vi.fn(async () => reply(200, fixture('provider-not-found.json')));
    const checker = createProviderChecker(env(ENV), fetchImpl as unknown as typeof fetch)!;
    await checker.check(INPUT);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENV['RTW_PROVIDER_URL']);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer synthetic-key');
    expect(JSON.parse(String(init.body))).toEqual({
      share_code: 'W123AB4CD',
      date_of_birth: '2002-02-12',
      company_name: 'The Hospitality Company',
      include_report: true,
    });
  });
});

describe('reading the answer', () => {
  it('a pass with a date, conditions and an inline PDF', async () => {
    const fetchImpl = vi.fn(async () => reply(200, fixture('provider-pass.json')));
    const out = await createProviderChecker(
      env(ENV),
      fetchImpl as unknown as typeof fetch,
      () => new Date(AT),
    )!.check(INPUT);
    expect(out.result).toEqual({
      outcome: 'right_to_work',
      fullName: 'Amara Kofi',
      rightToWorkUntil: '2028-03-31',
      conditions: ['They can work up to 20 hours a week during term time.'],
      termTimeLimitHours: 20,
      referenceNumber: 'SYNTH-PRV-000123',
      checkedAt: AT,
      source: 'provider',
    });
    expect(new TextDecoder().decode(out.report!).startsWith('%PDF-')).toBe(true);
  });

  it('settled status only when the provider says so, the report fetched from its link', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4 synthetic');
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('.pdf')
        ? new Response(pdf, { status: 200 })
        : reply(200, fixture('provider-settled.json')),
    );
    const out = await createProviderChecker(env(ENV), fetchImpl as unknown as typeof fetch)!.check(
      INPUT,
    );
    expect(out.result.outcome).toBe('right_to_work');
    expect(out.result.rightToWorkUntil).toBeNull();
    expect(out.result.fullName).toBe('Marta Villanueva');
    expect(out.report).toEqual(pdf);
    // The link is fetched with the same credentials.
    const second = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect((second[1].headers as Record<string, string>)['Authorization']).toBe(
      'Bearer synthetic-key',
    );
  });

  it('never reads a missing date as "no time limit" (ADR-0018)', () => {
    const r = mapProviderResponse(200, { outcome: 'valid', full_name: 'A B' }, AT).result;
    expect(r.outcome).toBe('error');
    expect(r.error).toBe('provider_no_expiry');
    expect(
      mapProviderResponse(200, { outcome: 'valid', expiry_date: 'soon' }, AT).result.error,
    ).toBe('provider_unreadable_date');
  });

  it('reads the dates both services print', () => {
    for (const printed of ['2028-03-31', '31/03/2028', '31 March 2028', '31 Mar 2028']) {
      expect(
        mapProviderResponse(200, { outcome: 'valid', valid_until: printed }, AT).result
          .rightToWorkUntil,
      ).toBe('2028-03-31');
    }
  });

  it('not found in a 200 body or a 404/422 that says so', () => {
    expect(mapProviderResponse(200, fixture('provider-not-found.json'), AT).result.outcome).toBe(
      'not_found',
    );
    expect(mapProviderResponse(404, { outcome: 'not_found' }, AT).result.outcome).toBe('not_found');
    expect(mapProviderResponse(422, { status: 'no_match' }, AT).result.outcome).toBe('not_found');
  });

  it('a 404 without that is an endpoint problem: an error, so gov.uk runs', () => {
    expect(mapProviderResponse(404, { message: 'Not Found' }, AT).result).toMatchObject({
      outcome: 'error',
      error: 'provider_http_404',
    });
  });

  it('no right to work', () => {
    expect(
      mapProviderResponse(200, { outcome: 'not_eligible', full_name: 'Hana Kato' }, AT).result,
    ).toMatchObject({
      outcome: 'no_right_to_work',
      fullName: 'Hana Kato',
      rightToWorkUntil: null,
    });
  });

  it('auth, server and unknown answers are errors with codes', () => {
    expect(mapProviderResponse(401, {}, AT).result.error).toBe('provider_http_401');
    expect(mapProviderResponse(503, null, AT).result.error).toBe('provider_http_503');
    expect(mapProviderResponse(200, { status: 'complete' }, AT).result.error).toBe(
      'provider_unknown_status',
    );
    expect(mapProviderResponse(200, { outcome: 'pending' }, AT).result.error).toBe(
      'provider_reported_error',
    );
  });

  it('a network failure or timeout is an error, not a throw', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout W123AB4CD'), {
      name: 'TimeoutError',
    });
    const fetchImpl = vi.fn(async () => {
      throw timeout;
    });
    const out = await createProviderChecker(env(ENV), fetchImpl as unknown as typeof fetch)!.check(
      INPUT,
    );
    expect(out.result).toMatchObject({ outcome: 'error', error: 'provider_timeout' });
    expect(JSON.stringify(out.result)).not.toContain('W123AB4CD');
  });

  it('keeps a non-PDF "report" off the profile', async () => {
    const fetchImpl = vi.fn(async () =>
      reply(200, {
        outcome: 'valid',
        valid_until: '2028-01-01',
        report_pdf_base64: Buffer.from('<html>').toString('base64'),
      }),
    );
    const out = await createProviderChecker(env(ENV), fetchImpl as unknown as typeof fetch)!.check(
      INPUT,
    );
    expect(out.report).toBeNull();
  });

  it('never carries the share code or the date of birth in a result', async () => {
    const fetchImpl = vi.fn(async () =>
      reply(200, {
        ...(fixture('provider-pass.json') as object),
        share_code: 'W123AB4CD',
        date_of_birth: '2002-02-12',
      }),
    );
    const out = await createProviderChecker(env(ENV), fetchImpl as unknown as typeof fetch)!.check(
      INPUT,
    );
    const text = JSON.stringify(out.result);
    expect(text).not.toContain('W123AB4CD');
    expect(text).not.toContain('2002-02-12');
  });
});
