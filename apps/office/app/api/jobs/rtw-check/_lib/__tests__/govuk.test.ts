import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideRtwCheck } from '@thc/domain';
import {
  createGovukChecker,
  driveGovuk,
  govukConfig,
  govukPhoto,
  parseGovukResult,
} from '../govuk';
import type { GovukBrowser, GovukLocator, GovukPage } from '../govuk';

/**
 * The gov.uk fallback against SYNTHETIC page text and a scripted fake page
 * (fixtures/README.md). gov.uk was not reachable when this was written: the
 * patterns in govuk.config.ts are assumptions, and so is every page here.
 */
const page = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const AT = '2026-09-25T07:00:00.000Z';
const INPUT = {
  shareCode: 'W123AB4CD',
  dateOfBirth: '2002-02-12',
  companyName: 'The Hospitality Company',
};

describe('parseGovukResult', () => {
  it('reads a student pass: date, name, the 20 h term limit, benign conditions, reference', () => {
    const r = parseGovukResult(page('govuk-pass-student.txt'), AT);
    expect(r).toMatchObject({
      outcome: 'right_to_work',
      fullName: 'Amara Kofi',
      rightToWorkUntil: '2028-03-31',
      termTimeLimitHours: 20,
      referenceNumber: 'SYNTH-RTW-4F7K2Q',
      source: 'govuk',
    });
    expect(r.conditions).toEqual([
      'They can work up to 20 hours a week during term time.',
      'They can work full-time during official vacations.',
      'They cannot be self-employed.',
    ]);
    // …which a student with that name, at degree level, passes.
    expect(
      decideRtwCheck(
        r,
        {
          firstName: 'Amara',
          lastName: 'Kofi',
          rtwBranch: 'international_student',
          belowDegreeLevel: false,
        },
        { attempt: 1, maxAttempts: 5, today: '2026-09-25' },
      ).action,
    ).toBe('verify');
  });

  it('reads settled status as no time limit because the page says so', () => {
    expect(parseGovukResult(page('govuk-pass-settled.txt'), AT)).toMatchObject({
      outcome: 'right_to_work',
      fullName: 'Marta Villanueva',
      rightToWorkUntil: null,
      conditions: ['No restrictions'],
    });
  });

  it('keeps a sponsor condition, which the decision sends to the office', () => {
    const r = parseGovukResult(page('govuk-pass-skilled.txt'), AT);
    expect(r.rightToWorkUntil).toBe('2027-06-14');
    expect(
      decideRtwCheck(
        r,
        { firstName: 'Priya', lastName: 'Shah', rtwBranch: 'work_visa', belowDegreeLevel: false },
        { attempt: 1, maxAttempts: 5, today: '2026-09-25' },
      ).action,
    ).toBe('needs_review');
  });

  it('not found and no right to work', () => {
    expect(parseGovukResult(page('govuk-not-found.txt'), AT).outcome).toBe('not_found');
    expect(parseGovukResult(page('govuk-no-right.txt'), AT)).toMatchObject({
      outcome: 'no_right_to_work',
      fullName: 'Hana Kato',
    });
  });

  it('a pass with no date and no "no time limit" is an error, never settled (ADR-0018)', () => {
    expect(parseGovukResult(page('govuk-pass-no-date.txt'), AT)).toMatchObject({
      outcome: 'error',
      error: 'govuk_no_expiry',
    });
  });

  it('pre-settled status is never read as no time limit (QA 25.09)', () => {
    expect(parseGovukResult(page('govuk-pre-settled-no-date.txt'), AT)).toMatchObject({
      outcome: 'error',
      error: 'govuk_no_expiry',
    });
    expect(parseGovukResult(page('govuk-pre-settled.txt'), AT)).toMatchObject({
      outcome: 'right_to_work',
      rightToWorkUntil: '2027-08-12',
    });
  });

  it('a student’s "cannot work in the UK for more than 20 hours" is a pass with the term limit, not no-right', () => {
    const r = parseGovukResult(page('govuk-pass-student-cannot.txt'), AT);
    expect(r).toMatchObject({
      outcome: 'right_to_work',
      rightToWorkUntil: '2028-03-31',
      termTimeLimitHours: 20,
    });
    expect(
      decideRtwCheck(
        r,
        {
          firstName: 'Amara',
          lastName: 'Kofi',
          rtwBranch: 'international_student',
          belowDegreeLevel: false,
        },
        { attempt: 1, maxAttempts: 5, today: '2026-09-25' },
      ).action,
    ).toBe('verify');
  });

  it('help text on a pass page cannot make it not-found or no-right', () => {
    expect(parseGovukResult(page('govuk-pass-with-help.txt'), AT)).toMatchObject({
      outcome: 'right_to_work',
      fullName: 'Ben Tran',
      rightToWorkUntil: '2026-10-30',
    });
  });

  it('anything else is an error', () => {
    expect(parseGovukResult(page('govuk-maintenance.txt'), AT).error).toBe(
      'govuk_unrecognised_result',
    );
    expect(parseGovukResult('   ', AT).error).toBe('govuk_empty_page');
  });
});

// ---------------------------------------------------------------------
// A scripted page: each "screen" lists the fields it shows and the text it
// reads as; Continue moves to the next screen.
// ---------------------------------------------------------------------
interface Screen {
  fields: string[];
  text: string;
  next?: boolean;
}

function fakeBrowser(screens: Screen[], filled: Record<string, string> = {}) {
  let at = 0;
  let pdfCalls = 0;
  const loc = (
    present: boolean,
    on: { fill?: (v: string) => void; click?: () => void; text?: () => string },
  ): GovukLocator => {
    const self: GovukLocator = {
      count: async () => (present ? 1 : 0),
      first: () => self,
      isVisible: async () => present,
      fill: async (v) => on.fill?.(v),
      click: async () => on.click?.(),
      innerText: async () => on.text?.() ?? '',
    };
    return self;
  };
  const field = (key: string) =>
    loc(screens[at]!.fields.includes(key), { fill: (v) => (filled[key] = v) });
  const labelKey = (re: RegExp): string =>
    re.test('Share code')
      ? 'shareCode'
      : re.test('Day')
        ? 'day'
        : re.test('Month')
          ? 'month'
          : re.test('Year')
            ? 'year'
            : re.test('Company name')
              ? 'company'
              : '?';
  const fake: GovukPage = {
    goto: async () => undefined,
    setDefaultTimeout: () => undefined,
    waitForLoadState: async () => undefined,
    getByLabel: (re) => field(labelKey(re)),
    getByRole: (role, { name }) =>
      role === 'button' && name.test('Continue')
        ? loc(screens[at]!.next !== false && screens[at]!.fields.length > 0, {
            click: () => (at += 1),
          })
        : loc(false, {}),
    locator: (css) =>
      css === 'main' ? loc(true, { text: () => screens[at]!.text }) : loc(false, {}),
    pdf: async () => {
      pdfCalls += 1;
      return new TextEncoder().encode('%PDF-1.7 synthetic');
    },
  };
  const browser: GovukBrowser & { closed: boolean } = {
    closed: false,
    newPage: async () => fake,
    close: async () => {
      browser.closed = true;
    },
  };
  return { browser, filled, pdfCalls: () => pdfCalls };
}

const CONFIG = { enabled: true, startUrl: 'https://gov.example/start', timeoutMs: 1000 };
const SCREENS: Screen[] = [
  { fields: ['shareCode'], text: 'Enter the share code' },
  { fields: ['day', 'month', 'year'], text: 'Enter their date of birth' },
  { fields: ['company'], text: 'Enter your company name' },
  { fields: [], text: page('govuk-pass-student.txt') },
];

describe('driveGovuk', () => {
  it('fills the three steps in order and reads the last page', async () => {
    const { browser, filled } = fakeBrowser(SCREENS);
    const { text, complete } = await driveGovuk(await browser.newPage(), INPUT, CONFIG);
    expect(complete).toBe(true);
    expect(text).toContain('Amara Kofi');
    expect(filled).toEqual({
      shareCode: 'W123AB4CD',
      day: '12',
      month: '2',
      year: '2002',
      company: 'The Hospitality Company',
    });
  });

  it('copes with the date of birth and code on one page', async () => {
    const { browser } = fakeBrowser([
      { fields: ['day', 'month', 'year', 'shareCode'], text: 'Enter details' },
      { fields: ['company'], text: 'Company' },
      { fields: [], text: page('govuk-pass-settled.txt') },
    ]);
    expect((await driveGovuk(await browser.newPage(), INPUT, CONFIG)).complete).toBe(true);
  });
});

describe('createGovukChecker', () => {
  it('is off unless RTW_GOVUK_ENABLED=true', () => {
    expect(
      createGovukChecker(
        () => undefined,
        async () => fakeBrowser(SCREENS).browser,
      ),
    ).toBeNull();
    expect(govukConfig((n) => (n === 'RTW_GOVUK_ENABLED' ? 'TRUE' : undefined)).enabled).toBe(true);
  });

  const enabled = (n: string) => (n === 'RTW_GOVUK_ENABLED' ? 'true' : undefined);

  it('a pass comes back with the page as the PDF report, and the browser is closed', async () => {
    const fake = fakeBrowser(SCREENS);
    const out = await createGovukChecker(
      enabled,
      async () => fake.browser,
      () => new Date(AT),
    )!.check(INPUT);
    expect(out.result.outcome).toBe('right_to_work');
    expect(new TextDecoder().decode(out.report!)).toMatch(/^%PDF-/);
    expect(fake.browser.closed).toBe(true);
  });

  it('not found takes no report', async () => {
    const fake = fakeBrowser([
      { fields: ['shareCode'], text: '' },
      { fields: ['day', 'month', 'year'], text: '' },
      { fields: ['company'], text: '' },
      { fields: [], text: page('govuk-not-found.txt') },
    ]);
    const out = await createGovukChecker(enabled, async () => fake.browser)!.check(INPUT);
    expect(out.result.outcome).toBe('not_found');
    expect(out.report).toBeNull();
    expect(fake.pdfCalls()).toBe(0);
  });

  it('a page without Continue is page_changed, naming only the step', async () => {
    const fake = fakeBrowser([{ fields: ['shareCode'], text: 'x', next: false }]);
    const out = await createGovukChecker(enabled, async () => fake.browser)!.check(INPUT);
    expect(out.result).toMatchObject({ outcome: 'error', error: 'govuk_page_changed:next' });
    expect(fake.browser.closed).toBe(true);
  });

  it('an incomplete flow is never parsed — even a not-found page is page_changed', async () => {
    const fake = fakeBrowser([
      { fields: ['shareCode'], text: '' },
      { fields: [], text: page('govuk-not-found.txt') },
    ]);
    const out = await createGovukChecker(enabled, async () => fake.browser)!.check(INPUT);
    expect(out.result).toMatchObject({ outcome: 'error', error: 'govuk_page_changed:inputs' });
    expect(fake.pdfCalls()).toBe(0);
  });

  it('a "result" reached without giving gov.uk the inputs is not a result', async () => {
    const fake = fakeBrowser([{ fields: [], text: page('govuk-pass-student.txt') }]);
    const out = await createGovukChecker(enabled, async () => fake.browser)!.check(INPUT);
    expect(out.result).toMatchObject({ outcome: 'error', error: 'govuk_page_changed:inputs' });
  });

  it('a browser that will not start is an error, not a throw', async () => {
    const out = await createGovukChecker(enabled, async () => {
      throw new Error('no chromium for W123AB4CD');
    })!.check(INPUT);
    expect(out.result).toMatchObject({ outcome: 'error', error: 'govuk_browser_launch_failed' });
  });

  it('a timeout is govuk_timeout', async () => {
    const fake = fakeBrowser(SCREENS);
    const pageWithTimeout = await fake.browser.newPage();
    pageWithTimeout.goto = async () => {
      throw Object.assign(new Error('Timeout 1000ms exceeded'), { name: 'TimeoutError' });
    };
    const out = await createGovukChecker(enabled, async () => ({
      newPage: async () => pageWithTimeout,
      close: async () => undefined,
    }))!.check(INPUT);
    expect(out.result.error).toBe('govuk_timeout');
  });
});

describe('govukPhoto (ADR-0041)', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  function pageWith(image: { css: string; bytes: Uint8Array } | null): GovukPage {
    const none: GovukLocator = {
      count: async () => 0,
      first: () => none,
      isVisible: async () => false,
      fill: async () => undefined,
      click: async () => undefined,
      innerText: async () => '',
    };
    const img: GovukLocator = {
      ...none,
      count: async () => 1,
      first: () => img,
      isVisible: async () => true,
      screenshot: async () => image!.bytes,
    };
    return {
      goto: async () => undefined,
      setDefaultTimeout: () => undefined,
      waitForLoadState: async () => undefined,
      getByLabel: () => none,
      getByRole: () => none,
      locator: (css) => (image && css === image.css ? img : none),
      pdf: async () => new Uint8Array(),
    };
  }

  it('screenshots the applicant photo as a PNG', async () => {
    expect(await govukPhoto(pageWith({ css: 'main img[alt*="photo" i]', bytes: PNG }))).toEqual(
      PNG,
    );
  });

  it('is null when the page shows no photo — the admin uses the one in the PDF', async () => {
    expect(await govukPhoto(pageWith(null))).toBeNull();
  });

  it('is null when what it captured is not a PNG', async () => {
    const notPng = new TextEncoder().encode('not an image');
    expect(
      await govukPhoto(pageWith({ css: 'main img[alt*="photo" i]', bytes: notPng })),
    ).toBeNull();
  });
});
