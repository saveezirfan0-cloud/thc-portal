import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideRtwCheck } from '@thc/domain';
import {
  createGovukChecker,
  driveGovuk,
  fitReportToOnePage,
  govukConfig,
  govukPhoto,
  pageHint,
  recordNameFromPage,
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

  it('live wording (28.09.2026): the lead-in and "sportsperson or coach" pass; the employer advice is not a condition', () => {
    const r = parseGovukResult(page('govuk-pass-visa-live-wording.txt'), AT);
    expect(r).toMatchObject({ outcome: 'right_to_work', rightToWorkUntil: '2028-07-15' });
    expect(r.conditions).toEqual([
      'On their current visa, they can work in any job except those listed in the conditions below.',
      'They cannot work as a professional sportsperson or coach.',
    ]);
    expect(
      decideRtwCheck(
        r,
        { firstName: 'Noor', lastName: 'Haddad', rtwBranch: 'work_visa', belowDegreeLevel: false },
        { attempt: 1, maxAttempts: 5, today: '2026-09-28' },
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

  it('reads the end date in the other ways gov.uk may word it (ordinal day, "ends on", "valid to")', () => {
    expect(parseGovukResult(page('govuk-pre-settled-ends-on.txt'), AT)).toMatchObject({
      outcome: 'right_to_work',
      rightToWorkUntil: '2027-08-12',
    });
    const valid = (line: string) =>
      parseGovukResult(
        `Name\nMarta Villanueva\nThey have permission to work in the UK.\n${line}\n`,
        AT,
      );
    expect(valid('Their status expires 12 August 2027.')).toMatchObject({
      rightToWorkUntil: '2027-08-12',
    });
    expect(valid('Valid to 12/08/2027')).toMatchObject({ rightToWorkUntil: '2027-08-12' });
    // The share code's own expiry is not the permission's end date…
    expect(
      parseGovukResult(
        'Name\nMarta Villanueva\nThey have permission to work in the UK until 12 August 2027.\nThis share code expires on 5 January 2027.\n',
        AT,
      ),
    ).toMatchObject({ outcome: 'right_to_work', rightToWorkUntil: '2027-08-12' });
    // …a word that merely ends in "end" is not a label…
    expect(
      parseGovukResult(
        'Name\nMarta Villanueva\nThey have permission to work in the UK.\nWeekend\n12 June 2026\n',
        AT,
      ),
    ).toMatchObject({ error: 'govuk_no_expiry' });
    // …and two different end dates are an error, not a guess.
    expect(
      parseGovukResult(
        'Name\nMarta Villanueva\nThey have permission to work in the UK until 12 August 2027.\nTheir visa expires on 3 March 2028.\n',
        AT,
      ),
    ).toMatchObject({ error: 'govuk_unreadable_date' });
    // A label alone on a line takes the date on the next line.
    expect(
      parseGovukResult(
        'Name\nMarta Villanueva\nThey have permission to work in the UK.\nExpiry date\n12 August 2027\n',
        AT,
      ),
    ).toMatchObject({ outcome: 'right_to_work', rightToWorkUntil: '2027-08-12' });
    // A date of birth on the page is never taken for the end date.
    expect(
      parseGovukResult(
        'Name\nMarta Villanueva\nDate of birth\n5 May 1996\nThey have permission to work in the UK.\n',
        AT,
      ),
    ).toMatchObject({ outcome: 'error', error: 'govuk_no_expiry' });
  });

  it('finds the end date wherever and however gov.uk words it, when it is the only future date', () => {
    const pass = (...lines: string[]) =>
      parseGovukResult(
        ['Name', 'Marta Villanueva', 'They have permission to work in the UK.', ...lines, ''].join(
          '\n',
        ),
        AT,
      );
    expect(
      pass('Immigration status: Pre-settled', 'Permission runs out 12 August 2027'),
    ).toMatchObject({
      outcome: 'right_to_work',
      rightToWorkUntil: '2027-08-12',
    });
    expect(pass('Granted 12 August 2021', 'Status finishes', 'August 12, 2027')).toMatchObject({
      rightToWorkUntil: '2027-08-12',
    });
    expect(pass('Final day: 2027-08-12')).toMatchObject({ rightToWorkUntil: '2027-08-12' });
    // The share code's own validity and a date of birth are never the end date…
    expect(pass('This share code is valid for 90 days, to 5 January 2027.')).toMatchObject({
      error: 'govuk_no_expiry',
    });
    expect(pass('Date of birth', '5 May 2999')).toMatchObject({ error: 'govuk_no_expiry' });
    // …a past date is not one…
    expect(pass('Permission granted 12 August 2021')).toMatchObject({ error: 'govuk_no_expiry' });
    // …and two future dates are an error, not a guess.
    expect(pass('Visa ends 12 August 2027', 'Review 3 March 2028')).toMatchObject({
      outcome: 'right_to_work',
      rightToWorkUntil: '2027-08-12',
    });
    expect(pass('Permission runs out 12 August 2027', 'Then 3 March 2028')).toMatchObject({
      error: 'govuk_unreadable_date',
    });
  });

  it('reads gov.uk\'s live "no limit on how long they can stay" as no time limit, and reaches a verify', () => {
    const r = parseGovukResult(page('govuk-pass-no-limit-live-wording.txt'), AT);
    expect(r).toMatchObject({ outcome: 'right_to_work', rightToWorkUntil: null });
    expect(r.conditions).toEqual([
      'They can work in any job.',
      'There is no limit on how long they can stay in the UK.',
    ]);
    const subject = (rtwBranch: 'eu_settled' | 'work_visa') => ({
      firstName: 'Olu',
      lastName: 'Ade',
      rtwBranch,
      belowDegreeLevel: false,
    });
    const ctx = { attempt: 1, maxAttempts: 5, today: '2026-10-06' };
    expect(decideRtwCheck(r, subject('eu_settled'), ctx)).toEqual({
      action: 'verify',
      rightToWorkUntil: null,
      noTimeLimit: true,
    });
    // A branch whose right to work always ends is still sent to the office.
    expect(decideRtwCheck(r, subject('work_visa'), ctx).action).toBe('needs_review');
  });

  it('verifies when gov.uk prints both condition sentences as ONE line (live, 06.10.2026)', () => {
    const r = parseGovukResult(page('govuk-pass-no-limit-one-line.txt'), AT);
    expect(r).toMatchObject({
      outcome: 'right_to_work',
      fullName: 'Olu Ade',
      rightToWorkUntil: null,
    });
    expect(r.conditions).toEqual([
      'They can work in any job. There is no limit on how long they can stay in the UK.',
    ]);
    expect(
      decideRtwCheck(
        r,
        { firstName: 'Olu', lastName: 'Ade', rtwBranch: 'eu_settled', belowDegreeLevel: false },
        { attempt: 1, maxAttempts: 5, today: '2026-10-06' },
      ),
    ).toEqual({ action: 'verify', rightToWorkUntil: null, noTimeLimit: true });
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
    // A maintenance page looks like this: it is retried, never filed as a report.
    const maintenance = parseGovukResult(page('govuk-maintenance.txt'), AT);
    expect(
      decideRtwCheck(
        maintenance,
        {
          firstName: 'Marta',
          lastName: 'Villanueva',
          rtwBranch: 'eu_settled',
          belowDegreeLevel: false,
        },
        { attempt: 1, maxAttempts: 5, today: '2026-09-25' },
      ).action,
    ).toBe('retry');
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

describe('pageHint — what the office is shown when the page cannot be read', () => {
  const input = {
    shareCode: 'W123AB4CD',
    dateOfBirth: '1996-05-05',
    companyName: 'The Hospitality Company',
    redact: ['Marta', 'Villanueva'],
  };

  it('masks the name, date of birth, share code and reference, and keeps the layout', () => {
    const hint = pageHint(
      [
        'Name',
        'Marta Villanueva',
        'Date of birth',
        '5 May 1996',
        'Share code W123AB4CD',
        'Reference number: SYNTH-RTW-9ZX1PA',
        'Pre-settled status',
        'Status granted',
        '12 August 2021',
      ].join('\n'),
      input,
    )!;
    expect(hint).not.toMatch(/Marta|Villanueva|W123|1996|SYNTH/);
    expect(hint.split(' | ')).toEqual([
      'Name',
      '▢ ▢',
      'Date of birth ▢',
      'Share code ▢',
      'Reference number: ▢',
      'Pre-settled status',
      'Status granted 12 August 2021',
    ]);
  });

  it('drops the page footer, and is null when nothing is about status, a name or a number', () => {
    expect(pageHint('Welcome\nSomething else entirely', input)).toBeNull();
    expect(
      pageHint(
        'keep a secure copy of this online check for 2 years\nAll content is available under the Open Government Licence v3.0',
        input,
      ),
    ).toBeNull();
    expect(pageHint('They have permission to work in the UK.', input)).toBe(
      'They have permission to work in the UK.',
    );
  });

  it('never returns more than eight lines', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Item ${i + 1} on 1${i} June 2030`).join(
      '\n',
    );
    expect(pageHint(many, input)!.split(' | ')).toHaveLength(8);
  });

  it('comes back from the checker when a pass has no end date', async () => {
    const fake = fakeBrowser([
      { fields: ['shareCode'], text: '' },
      { fields: ['day', 'month', 'year'], text: '' },
      { fields: ['company'], text: '' },
      {
        fields: [],
        text: 'Name\nOlu Ade\nThey have permission to work in the UK.\nStatus type 4\n',
      },
    ]);
    const out = await createGovukChecker(
      (n) => (n === 'RTW_GOVUK_ENABLED' ? 'true' : undefined),
      async () => fake.browser,
    )!.check({ ...input, redact: ['Olu', 'Ade'] });
    expect(out.result.error).toBe('govuk_no_expiry');
    expect(out.hint).toBe('Name | ▢ ▢ | They have permission to work in the UK. | Status type 4');
  });
});

describe("the record holder's name, whatever the layout", () => {
  const text = (nameBlock: string) =>
    `${nameBlock}\nThey have the right to work in the UK.\nConditions\nThey can work in any job.\nThere is no limit on how long they can stay in the UK.\n`;

  it('reads "Name: X", "Name<tab>X" and a name on the line below its label', () => {
    for (const block of ['Name: Olu Ade', 'Name\tOlu Ade', 'Name   Olu Ade', 'Name\nOlu Ade']) {
      expect(parseGovukResult(text(block), AT).fullName, block).toBe('Olu Ade');
    }
  });

  it("finds the profile's own name on a page with no label, and never a stranger's", () => {
    expect(recordNameFromPage('View details\nOlu Ade\nRight to work', ['Olu', 'Ade'])).toBe(
      'Olu Ade',
    );
    expect(recordNameFromPage('View details\nSam Jones\nRight to work', ['Olu', 'Ade'])).toBeNull();
    expect(recordNameFromPage('Olu Ade', ['Olu'])).toBeNull();
  });

  it('a pass whose name has no label still reaches the checker with the name filled in', async () => {
    const fake = fakeBrowser([
      { fields: ['shareCode'], text: '' },
      { fields: ['day', 'month', 'year'], text: '' },
      { fields: ['company'], text: '' },
      { fields: [], text: text('Olu Ade') },
    ]);
    const out = await createGovukChecker(
      (n) => (n === 'RTW_GOVUK_ENABLED' ? 'true' : undefined),
      async () => fake.browser,
    )!.check({
      shareCode: 'W123AB4CD',
      dateOfBirth: '1996-05-05',
      companyName: 'The Hospitality Company',
      redact: ['Olu', 'Ade'],
    });
    expect(out.result).toMatchObject({ outcome: 'right_to_work', fullName: 'Olu Ade' });
    expect(out.hint).toBeNull();
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

  it('a result page whose end date cannot be read is printed for the office; a maintenance page is not', async () => {
    const screens = (text: string) => [
      { fields: ['shareCode'], text: '' },
      { fields: ['day', 'month', 'year'], text: '' },
      { fields: ['company'], text: '' },
      { fields: [], text },
    ];
    const unreadable = fakeBrowser(screens(page('govuk-pass-no-date.txt')));
    const out = await createGovukChecker(enabled, async () => unreadable.browser)!.check(INPUT);
    expect(out.result).toMatchObject({ outcome: 'error', error: 'govuk_no_expiry' });
    expect(new TextDecoder().decode(out.report!)).toMatch(/^%PDF-/);

    const maintenance = fakeBrowser(screens(page('govuk-maintenance.txt')));
    const down = await createGovukChecker(enabled, async () => maintenance.browser)!.check(INPUT);
    expect(down.result).toMatchObject({ error: 'govuk_unrecognised_result' });
    expect(down.report).toBeNull();
    expect(maintenance.pdfCalls()).toBe(0);
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

describe('fitReportToOnePage', () => {
  const calls: string[] = [];
  const reportPage = (height: unknown, fail = false): GovukPage =>
    ({
      emulateMedia: async () => void calls.push('media'),
      addStyleTag: async ({ content }: { content: string }) => void calls.push(content),
      setViewportSize: async () => void calls.push('viewport'),
      evaluate: async () => {
        if (fail) throw new Error('page closed');
        return height;
      },
    }) as unknown as GovukPage;

  it('hides the cookie banner and page furniture before printing', async () => {
    calls.length = 0;
    await fitReportToOnePage(reportPage(500));
    const css = calls.find((c) => c.includes('display: none'));
    expect(css).toMatch(/cookie-banner/);
    expect(css).toMatch(/footer/);
    expect(css).not.toMatch(/\bmain\b/);
  });

  it('leaves a page that already fits at full size', async () => {
    const out = await fitReportToOnePage(reportPage(600));
    expect(out.scale).toBeUndefined();
    expect(out.margin.top).toBe('10mm');
  });

  it('scales a taller page down so it fits one A4 sheet, never below 0.1', async () => {
    const tall = await fitReportToOnePage(reportPage(2000));
    expect(tall.scale).toBeGreaterThan(0.1);
    expect(tall.scale! * 2000).toBeLessThanOrEqual(1123 - 2 * 38);
    expect((await fitReportToOnePage(reportPage(1_000_000))).scale).toBe(0.1);
  });

  it('prints unscaled when the page cannot be measured', async () => {
    expect((await fitReportToOnePage(reportPage('x'))).scale).toBeUndefined();
    expect((await fitReportToOnePage(reportPage(1, true))).scale).toBeUndefined();
    expect((await fitReportToOnePage({} as GovukPage)).scale).toBeUndefined();
  });
});
