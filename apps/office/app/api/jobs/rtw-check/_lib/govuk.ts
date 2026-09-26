import { rtwCheckError, safeErrorCode, termTimeLimitFrom } from '@thc/domain';
import type { RtwCheckResult } from '@thc/domain';
import { envNumber, envText, looksLikePdf, looksLikePng, parseUkDate } from './checker';
import type { CheckInput, CheckOutput, EnvReader, RightToWorkChecker } from './checker';
import {
  GOVUK_DEFAULT_START_URL,
  GOVUK_MAX_PAGES,
  GOVUK_RESULT,
  GOVUK_SECTION_END,
  GOVUK_SELECTORS,
} from './govuk.config';
import type { GovukSelectors, Strategy } from './govuk.config';

/**
 * The FALLBACK adapter: our own check of gov.uk/view-right-to-work in a
 * headless Chromium (ADR-0025). Used only when the provider errors or is not
 * configured. Every assumption about gov.uk's pages is in `govuk.config.ts`.
 *
 * The browser is behind two small interfaces so the flow is tested with a
 * scripted fake page, and so this file never imports Playwright: the real
 * launcher (`govuk.launch.ts`) loads playwright-core and @sparticuz/chromium
 * only when a check actually runs.
 */

export interface GovukLocator {
  count(): Promise<number>;
  first(): GovukLocator;
  isVisible(): Promise<boolean>;
  fill(value: string): Promise<void>;
  click(): Promise<void>;
  innerText(): Promise<string>;
  /** Playwright's element screenshot; optional so a scripted test page need not draw. */
  screenshot?(options: { type: 'png' }): Promise<Uint8Array>;
}

export interface GovukPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' }): Promise<unknown>;
  getByLabel(text: RegExp): GovukLocator;
  getByRole(role: 'button' | 'link' | 'textbox', options: { name: RegExp }): GovukLocator;
  locator(selector: string): GovukLocator;
  waitForLoadState(state?: 'load' | 'domcontentloaded'): Promise<void>;
  setDefaultTimeout(ms: number): void;
  pdf(options: { format: string; printBackground: boolean }): Promise<Uint8Array>;
}

export interface GovukBrowser {
  newPage(): Promise<GovukPage>;
  close(): Promise<void>;
}

export type GovukLauncher = () => Promise<GovukBrowser>;

export interface GovukConfig {
  enabled: boolean;
  startUrl: string;
  timeoutMs: number;
}

export function govukConfig(env: EnvReader): GovukConfig {
  return {
    enabled: envText(env, 'RTW_GOVUK_ENABLED')?.toLowerCase() === 'true',
    startUrl: envText(env, 'RTW_GOVUK_START_URL') ?? GOVUK_DEFAULT_START_URL,
    timeoutMs: envNumber(env, 'RTW_GOVUK_TIMEOUT_MS', 30_000),
  };
}

// ---------------------------------------------------------------------
// Reading the result page — pure, tested against synthetic page text.
// ---------------------------------------------------------------------

function firstCapture(patterns: readonly RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

const any = (patterns: readonly RegExp[], text: string) => patterns.some((p) => p.test(text));

/** The work conditions: the lines under a Conditions heading, and any line that reads as one. */
export function govukConditions(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim());
  const found: string[] = [];
  const heading = lines.findIndex((l) => GOVUK_RESULT.conditionsHeading.test(l));
  if (heading >= 0) {
    for (const line of lines.slice(heading + 1)) {
      if (line === '') {
        if (found.length > 0) break;
        continue;
      }
      if (GOVUK_SECTION_END.test(line)) break;
      found.push(line);
    }
  }
  for (const line of lines) {
    if (line && GOVUK_RESULT.conditionLine.some((p) => p.test(line)) && !found.includes(line)) {
      found.push(line);
    }
  }
  return found.slice(0, 30);
}

/**
 * The visible text of gov.uk's last page as a normalised result. Anything it
 * does not recognise is an `error` (retried, then the office) — never a pass.
 */
export function parseGovukResult(text: string, checkedAt: string): RtwCheckResult {
  const t = text.replace(/\r/g, '');
  if (t.trim() === '') return rtwCheckError('govuk', 'govuk_empty_page', checkedAt);

  const base = {
    fullName: null,
    rightToWorkUntil: null,
    conditions: [] as string[],
    termTimeLimitHours: null,
    referenceNumber: firstCapture(GOVUK_RESULT.reference, t),
    checkedAt,
    source: 'govuk' as const,
  };

  const fullName = firstCapture(GOVUK_RESULT.name, t);
  const noRight = any(GOVUK_RESULT.noRight, t);
  const right = any(GOVUK_RESULT.right, t);

  // "Not found" only on a page that states no outcome and names nobody:
  // help text on a result page must never turn a pass into a re-enter.
  if (!noRight && !right && !fullName && any(GOVUK_RESULT.notFound, t)) {
    return { ...base, outcome: 'not_found', referenceNumber: null };
  }
  if (noRight && right) return rtwCheckError('govuk', 'govuk_contradictory_result', checkedAt);
  if (noRight) return { ...base, outcome: 'no_right_to_work', fullName };
  if (!right) return rtwCheckError('govuk', 'govuk_unrecognised_result', checkedAt);

  const rawUntil = firstCapture(GOVUK_RESULT.until, t);
  const until = rawUntil ? parseUkDate(rawUntil) : null;
  if (rawUntil && !until) return rtwCheckError('govuk', 'govuk_unreadable_date', checkedAt);
  // ADR-0018: "no time limit" only when gov.uk says so, never from a blank.
  if (!until && !any(GOVUK_RESULT.noTimeLimit, t)) {
    return rtwCheckError('govuk', 'govuk_no_expiry', checkedAt);
  }

  const conditions = govukConditions(t);
  return {
    ...base,
    outcome: 'right_to_work',
    fullName,
    rightToWorkUntil: until,
    conditions,
    termTimeLimitHours: termTimeLimitFrom(conditions),
  };
}

// ---------------------------------------------------------------------
// Driving the form.
// ---------------------------------------------------------------------

async function find(
  page: GovukPage,
  strategies: readonly Strategy[],
): Promise<GovukLocator | null> {
  for (const s of strategies) {
    const locator =
      'label' in s
        ? page.getByLabel(s.label)
        : 'role' in s
          ? page.getByRole(s.role, { name: s.name })
          : page.locator(s.css);
    if ((await locator.count()) > 0) {
      const first = locator.first();
      if (await first.isVisible()) return first;
    }
  }
  return null;
}

/**
 * The applicant's photo as a PNG, for the admin's side-by-side comparison
 * (ADR-0041). Best effort: a missing or odd image is null, never a failed
 * check — the same photo is in the PDF.
 */
export async function govukPhoto(page: GovukPage): Promise<Uint8Array | null> {
  try {
    const image = await find(page, GOVUK_SELECTORS.photo);
    if (!image?.screenshot) return null;
    const bytes = await image.screenshot({ type: 'png' });
    return looksLikePng(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

class PageChanged extends Error {
  constructor(readonly step: string) {
    super(`govuk_page_changed:${step}`);
    this.name = 'PageChanged';
  }
}

/** DOB `1996-05-05` → the three boxes gov.uk asks for: `5`, `5`, `1996`. */
function dobParts(iso: string): [string, string, string] {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return [String(Number(d)), String(Number(m)), y ?? ''];
}

/**
 * Fill whatever of the three steps this page shows, press Continue, and go
 * on until a page asks for nothing — the result (or a refusal) — then read
 * it. Returns the page's text and whether every input was given.
 */
export async function driveGovuk(
  page: GovukPage,
  input: CheckInput,
  config: GovukConfig,
  selectors: GovukSelectors = GOVUK_SELECTORS,
): Promise<{ text: string; complete: boolean }> {
  page.setDefaultTimeout(config.timeoutMs);
  await page.goto(config.startUrl, { waitUntil: 'domcontentloaded' });

  const start = await find(page, selectors.start);
  if (start) {
    await start.click();
    await page.waitForLoadState('domcontentloaded');
  }

  const done = { shareCode: false, dateOfBirth: false, companyName: false };
  for (let i = 0; i < GOVUK_MAX_PAGES; i += 1) {
    let filled = false;
    if (!done.shareCode) {
      const field = await find(page, selectors.shareCode);
      if (field) {
        await field.fill(input.shareCode);
        done.shareCode = filled = true;
      }
    }
    if (!done.dateOfBirth) {
      const day = await find(page, selectors.dobDay);
      if (day) {
        const month = await find(page, selectors.dobMonth);
        const year = await find(page, selectors.dobYear);
        if (!month || !year) throw new PageChanged('dateOfBirth');
        const [d, m, y] = dobParts(input.dateOfBirth);
        await day.fill(d);
        await month.fill(m);
        await year.fill(y);
        done.dateOfBirth = filled = true;
      }
    }
    if (!done.companyName) {
      const field = await find(page, selectors.companyName);
      if (field) {
        await field.fill(input.companyName);
        done.companyName = filled = true;
      }
    }
    if (!filled) break;
    const next = await find(page, selectors.next);
    if (!next) throw new PageChanged('next');
    await next.click();
    await page.waitForLoadState('domcontentloaded');
  }

  const root = await find(page, selectors.resultRoot);
  const text = root ? await root.innerText() : '';
  return { text, complete: done.shareCode && done.dateOfBirth };
}

export function createGovukChecker(
  env: EnvReader,
  launch: GovukLauncher,
  now: () => Date = () => new Date(),
): RightToWorkChecker | null {
  const config = govukConfig(env);
  if (!config.enabled) return null;

  return {
    source: 'govuk',
    async check(input: CheckInput): Promise<CheckOutput> {
      const checkedAt = now().toISOString();
      let browser: GovukBrowser;
      try {
        browser = await launch();
      } catch {
        return {
          result: rtwCheckError('govuk', 'govuk_browser_launch_failed', checkedAt),
          report: null,
        };
      }
      try {
        const page = await browser.newPage();
        const { text, complete } = await driveGovuk(page, input, config);
        if (!complete) {
          // A page reached without ever giving gov.uk the code AND the date
          // of birth is not an answer about this person, whatever it says —
          // it is never parsed (QA 25.09). Retried, then the office.
          return {
            result: rtwCheckError('govuk', 'govuk_page_changed:inputs', checkedAt),
            report: null,
          };
        }
        const result = parseGovukResult(text, checkedAt);
        let report: Uint8Array | null = null;
        let photo: Uint8Array | null = null;
        if (result.outcome === 'right_to_work' || result.outcome === 'no_right_to_work') {
          photo = await govukPhoto(page);
          const bytes = await page.pdf({ format: 'A4', printBackground: true });
          report = looksLikePdf(bytes) ? bytes : null;
        }
        return { result, report, photo };
      } catch (cause) {
        const code =
          cause instanceof PageChanged
            ? cause.message
            : cause instanceof Error && cause.name === 'TimeoutError'
              ? 'govuk_timeout'
              : safeErrorCode(`govuk_failed_${cause instanceof Error ? cause.name : 'error'}`);
        return { result: rtwCheckError('govuk', code, checkedAt), report: null };
      } finally {
        await browser.close().catch(() => undefined);
      }
    },
  };
}
