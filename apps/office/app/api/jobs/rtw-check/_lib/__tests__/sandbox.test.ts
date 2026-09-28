import { describe, expect, it, vi } from 'vitest';
import { decideRtwCheck, isValidShareCode } from '@thc/domain';
import type { RtwBranch } from '@thc/domain';
import { looksLikePdf, looksLikePng } from '../checker';
import { createProviderChecker } from '../provider';
import {
  addYears,
  createSandboxProviderFetch,
  isSandboxProviderUrl,
  rtwSandboxEnabled,
  SANDBOX_PERSONAS,
  sandboxEnv,
  sandboxPhotoPng,
} from '../sandbox';

/**
 * The sandbox provider (ADR-0063) through the REAL provider adapter and the
 * REAL decision: what the office sees for each demo share code.
 */
const NOW = new Date('2026-09-28T09:30:00.000Z');
const TODAY = '2026-09-28';
const DOB = '1999-04-17';
const HOLDER = { firstName: 'Lucía', lastName: 'Fernández' };

const env = (vars: Record<string, string>) => (name: string) => vars[name];
const SANDBOX_ENV = { RTW_PROVIDER_URL: 'sandbox:' };

function checker(
  lookup = vi.fn(async (): Promise<string | null> => `${HOLDER.firstName} ${HOLDER.lastName}`),
) {
  const fetchImpl = createSandboxProviderFetch({ lookupHolder: lookup, now: () => NOW });
  return {
    lookup,
    checker: createProviderChecker(sandboxEnv(env(SANDBOX_ENV)), fetchImpl, () => NOW)!,
  };
}

async function run(code: string, branch: RtwBranch, attempt = 1) {
  const { checker: c, lookup } = checker();
  const out = await c.check({
    shareCode: code,
    dateOfBirth: DOB,
    companyName: 'The Hospitality Company',
  });
  const decision = decideRtwCheck(
    out.result,
    { ...HOLDER, rtwBranch: branch, belowDegreeLevel: false },
    { attempt, maxAttempts: 5, today: TODAY },
  );
  return { out, decision, lookup };
}

describe('switching it on', () => {
  it('only a sandbox: URL turns it on', () => {
    expect(isSandboxProviderUrl('sandbox:')).toBe(true);
    expect(isSandboxProviderUrl('SANDBOX://thc')).toBe(true);
    expect(isSandboxProviderUrl('https://provider.example/v1')).toBe(false);
    expect(rtwSandboxEnabled(env(SANDBOX_ENV))).toBe(true);
    expect(rtwSandboxEnabled(env({}))).toBe(false);
  });

  it('needs no key: the adapter is available with the URL alone', () => {
    expect(createProviderChecker(env(SANDBOX_ENV))).toBeNull();
    expect(createProviderChecker(sandboxEnv(env(SANDBOX_ENV)))).not.toBeNull();
  });

  it('every demo code is a share code the Staff App accepts', () => {
    for (const p of SANDBOX_PERSONAS) expect(isValidShareCode(p.code), p.code).toBe(true);
  });
});

describe('what each demo code gives the office', () => {
  it('WDEMOPASS: a pass for two years, with the report, the photo and the holder looked up by code + DOB', async () => {
    const { out, decision, lookup } = await run('WDEMOPASS', 'work_visa');
    expect(lookup).toHaveBeenCalledWith('WDEMOPASS', DOB);
    expect(out.result).toMatchObject({
      outcome: 'right_to_work',
      fullName: 'Lucía Fernández',
      rightToWorkUntil: '2028-09-28',
      source: 'provider',
      referenceNumber: 'SANDBOX-DEMOPASS-20260928T0930',
    });
    expect(looksLikePdf(out.report)).toBe(true);
    expect(looksLikePng(out.photo)).toBe(true);
    expect(decision).toEqual({
      action: 'verify',
      rightToWorkUntil: '2028-09-28',
      noTimeLimit: false,
    });
  });

  it('WDEMOSETL: settled status, no time limit, on the EU settled branch', async () => {
    const { out, decision } = await run('WDEMOSETL', 'eu_settled');
    expect(out.result.rightToWorkUntil).toBeNull();
    expect(decision).toEqual({ action: 'verify', rightToWorkUntil: null, noTimeLimit: true });
  });

  it('WDEMOSTDY: a Student visa at 20 hours in term time', async () => {
    const { out, decision } = await run('WDEMOSTDY', 'international_student');
    expect(out.result.termTimeLimitHours).toBe(20);
    expect(decision).toEqual({
      action: 'verify',
      rightToWorkUntil: '2027-09-28',
      noTimeLimit: false,
    });
  });

  it('WDEMONAME: a name that is not the profile name goes to review', async () => {
    const { decision } = await run('WDEMONAME', 'work_visa');
    expect(decision).toMatchObject({ action: 'needs_review' });
    expect((decision as { officeReason: string }).officeReason).toMatch(
      /name on the gov.uk record/,
    );
  });

  it('WDEMOCOND: an unrecognised condition goes to review', async () => {
    const { decision } = await run('WDEMOCOND', 'work_visa');
    expect(decision).toMatchObject({ action: 'needs_review' });
    expect((decision as { officeReason: string }).officeReason).toMatch(/work condition/);
  });

  it('WDEMONONE: not found — no report, no photo, a reject', async () => {
    const { out, decision, lookup } = await run('WDEMONONE', 'work_visa');
    expect(lookup).not.toHaveBeenCalled();
    expect(out.result.outcome).toBe('not_found');
    expect(out.report).toBeNull();
    expect(out.photo ?? null).toBeNull();
    expect(decision).toMatchObject({ action: 'reject' });
  });

  it('WDEMONORW: no right to work — the report and photo, and a reject', async () => {
    const { out, decision } = await run('WDEMONORW', 'work_visa');
    expect(out.result.outcome).toBe('no_right_to_work');
    expect(looksLikePdf(out.report)).toBe(true);
    expect(looksLikePng(out.photo)).toBe(true);
    expect(decision).toMatchObject({ action: 'reject' });
  });

  it('WDEMODOWN: the provider is down — retried, then the office', async () => {
    const first = await run('WDEMODOWN', 'work_visa', 1);
    expect(first.out.result).toMatchObject({ outcome: 'error', error: 'provider_http_503' });
    expect(first.decision).toMatchObject({ action: 'retry' });
    const last = await run('WDEMODOWN', 'work_visa', 5);
    expect(last.decision).toMatchObject({ action: 'needs_review' });
  });
});

describe('it never answers for a real person', () => {
  it('a code that is not a demo code is an error, not an outcome — and nobody is looked up', async () => {
    const { checker: c, lookup } = checker();
    const out = await c.check({
      shareCode: 'W123AB4CD',
      dateOfBirth: DOB,
      companyName: 'The Hospitality Company',
    });
    expect(out.result).toMatchObject({ outcome: 'error', error: 'provider_http_404' });
    expect(out.report).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a demo code filed with another date of birth is not found, as on gov.uk', async () => {
    const { checker: c } = checker(vi.fn(async () => null));
    const out = await c.check({
      shareCode: 'WDEMOPASS',
      dateOfBirth: '2001-01-01',
      companyName: 'The Hospitality Company',
    });
    expect(out.result.outcome).toBe('not_found');
  });

  it('refuses anything but the check POST', async () => {
    const fetchImpl = createSandboxProviderFetch({ lookupHolder: async () => 'x' });
    expect((await fetchImpl('https://provider.example', { method: 'POST' })).status).toBe(404);
    expect((await fetchImpl('sandbox:', { method: 'GET' })).status).toBe(404);
    expect(
      (await fetchImpl('sandbox:', { method: 'POST', body: '{"share_code":"WDEMOPASS"}' })).status,
    ).toBe(401);
  });
});

describe('the stored result', () => {
  it('never carries the share code, which rtw_check_clean_result() refuses', async () => {
    for (const p of SANDBOX_PERSONAS) {
      const { out } = await run(p.code, 'work_visa');
      const letters = JSON.stringify(out.result)
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase();
      expect(letters, p.code).not.toContain(p.code);
    }
  });
});

describe('the report and the photo', () => {
  it('the report is marked SANDBOX and carries the reference', async () => {
    const { out } = await run('WDEMOPASS', 'work_visa');
    const text = new TextDecoder().decode(out.report!);
    expect(text).toContain('SANDBOX - NOT A HOME OFFICE RESULT');
    expect(text).toContain('SANDBOX-DEMOPASS-20260928T0930');
    expect(text).toContain('28 September 2028');
    // Accents are folded, never raw bytes in a standard-font PDF.
    expect(text).toContain('Lucia Fernandez');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('the PDF cross-reference offsets point at their objects', async () => {
    const { out } = await run('WDEMOSETL', 'eu_settled');
    const text = new TextDecoder().decode(out.report!);
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const offsets = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    offsets.forEach((offset, i) => expect(text.slice(offset, offset + 8)).toBe(`${i + 1} 0 obj\n`));
  });

  it('the photo is a PNG well under the 2 MB limit', () => {
    const png = sandboxPhotoPng();
    expect(looksLikePng(png)).toBe(true);
    expect(png.length).toBeLessThan(50_000);
  });

  it('adds whole years, and 29 February falls back to the 28th', () => {
    expect(addYears('2026-09-28', 2)).toBe('2028-09-28');
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
  });
});
