import {
  isResultPageRtwError,
  nameTokens,
  rtwCheckError,
  safeErrorCode,
  termTimeLimitFrom,
} from '@thc/domain';
import type { RtwCheckResult } from '@thc/domain';
import { envNumber, envText, looksLikePdf, looksLikePng, parseUkDate, ukToday } from './checker';
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

/**
 * The end date as printed, or null (none found) — or 'ambiguous' when two
 * different dates qualify. Never a guess (ADR-0018): a wrong future date
 * would otherwise reach Verify.
 */
export function captureUntil(text: string): string | 'ambiguous' | null {
  const lines = text.split('\n').map((l) => l.trim());
  const found = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line || GOVUK_RESULT.untilNotLine.test(line)) continue;
    const candidate = GOVUK_RESULT.untilLabelOnly.test(line)
      ? `${line} ${lines[i + 1] ?? ''}`
      : line;
    for (const pattern of GOVUK_RESULT.until) {
      const raw = pattern.exec(candidate)?.[1];
      if (raw) found.add(parseUkDate(raw) ?? raw.trim());
    }
  }
  if (found.size > 1) return 'ambiguous';
  return found.size === 1 ? [...found][0]! : null;
}

const DATE_PATTERNS: readonly RegExp[] = [
  /\b(\d{1,2}(?:st|nd|rd|th)?[^\S\r\n]+[A-Za-z]{3,9}\.?,?[^\S\r\n]+\d{4})\b/g,
  /\b([A-Za-z]{3,9}\.?[^\S\r\n]+\d{1,2}(?:st|nd|rd|th)?,?[^\S\r\n]+\d{4})\b/g,
  /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})\b/g,
  /\b(\d{4}-\d{2}-\d{2})\b/g,
];

/** Every date written on one line, as ISO dates (any of the usual UK/gov.uk spellings). */
export function datesOnLine(line: string): string[] {
  const found: string[] = [];
  for (const pattern of DATE_PATTERNS) {
    for (const m of line.matchAll(pattern)) {
      let raw = m[1]!.replace(/,/g, '').trim();
      const monthFirst = /^[A-Za-z]/.exec(raw);
      if (monthFirst) {
        const parts = raw.split(/\s+/);
        if (parts.length === 3) raw = `${parts[1]} ${parts[0]} ${parts[2]}`;
      }
      const iso = parseUkDate(raw);
      if (iso && !found.includes(iso)) found.push(iso);
    }
  }
  return found;
}

/**
 * The one date on the page still in the future, or 'ambiguous', or null.
 * Only a LAST resort after the labelled patterns found nothing (see
 * `GOVUK_RESULT.futureDateNotContext`). A date alone on its line takes the
 * line above as its context, so "Date of birth / 5 May 2999" is never read.
 */
export function onlyFutureDate(text: string, today: string): string | 'ambiguous' | null {
  const lines = text.split('\n').map((l) => l.trim());
  const future = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const dates = datesOnLine(line);
    if (dates.length === 0) continue;
    const bare =
      line.replace(/[\d/.\-:,]|\b(?:st|nd|rd|th)\b|[A-Za-z]{3,9}\.?(?=\s+\d)/g, '').trim() === '';
    const context = bare ? `${lines[i - 1] ?? ''} ${line}` : line;
    if (GOVUK_RESULT.futureDateNotContext.test(context)) continue;
    for (const d of dates) if (d > today) future.add(d);
  }
  if (future.size > 1) return 'ambiguous';
  return future.size === 1 ? [...future][0]! : null;
}

/**
 * Lines of a result page about the person's status and permission, or that
 * carry a number or a date — with the worker's name, date of birth and share
 * code left out — for the office (see `CheckOutput.hint`). A line about
 * birth, the share code, a reference or a name is dropped whole, as is the
 * page's footer; a date alone on a line keeps the label above it. At most six
 * lines of 100 characters.
 */
const HINT_STATUS_WORDS =
  /status|settled|permission|right to work|expir|time limit|indefinite|\bleave\b|visa|scheme|valid|until|condition|\bcan work\b|\bcannot work\b/i;
const HINT_BOILERPLATE =
  /secure copy|open government licence|cookies?|privacy|accessibility statement|crown copyright|terms and conditions|skip to|\bmenu\b|\bfeedback\b/i;

function isBareDate(line: string): boolean {
  return (
    /\d/.test(line) &&
    line.replace(/[\d/.\-:,]|(?<=\d)(?:st|nd|rd|th)|[A-Za-z]{3,9}\.?(?=\s+\d)/g, '').trim() === ''
  );
}

export function pageHint(text: string, input: CheckInput): string | null {
  const code = input.shareCode.replace(/\s+/g, '').toUpperCase();
  const names = new Set(
    (input.redact ?? []).flatMap((n) => nameTokens(n)).filter((n) => n.length > 1),
  );
  const dob = input.dateOfBirth.slice(0, 10);
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const banned = /birth|\bborn\b|share\s*code|\bcode\b|reference|\bname\b|nationality|photo/i;
  const keep: string[] = [];
  for (let i = 0; i < lines.length && keep.length < 6; i += 1) {
    const line = lines[i]!;
    if (!line || !(/\d/.test(line) || HINT_STATUS_WORDS.test(line))) continue;
    const bare = isBareDate(line);
    // A label above a date alone on its line is shown with that date, once.
    if (!bare && isBareDate(lines[i + 1] ?? '') && i + 1 < lines.length) continue;
    const shown = bare && i > 0 && lines[i - 1] ? `${lines[i - 1]} ${line}` : line;
    if (banned.test(shown) || HINT_BOILERPLATE.test(shown)) continue;
    if (shown.replace(/\s+/g, '').toUpperCase().includes(code)) continue;
    if (datesOnLine(shown).includes(dob)) continue;
    if (nameTokens(shown).some((t) => names.has(t))) continue;
    if (keep.includes(shown.slice(0, 100))) continue;
    keep.push(shown.slice(0, 100));
  }
  return keep.length > 0 ? keep.join(' | ') : null;
}

/** The work conditions: the lines under a Conditions heading, and any line that reads as one. */
export function govukConditions(text: string): string[] {
  const advice = (line: string) => any(GOVUK_RESULT.notCondition, line);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !advice(l));
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

  let rawUntil = captureUntil(t);
  if (rawUntil === 'ambiguous') return rtwCheckError('govuk', 'govuk_unreadable_date', checkedAt);
  if (rawUntil === null) {
    // No labelled end date: the only future date on the page is it.
    const only = onlyFutureDate(t, ukToday(new Date(checkedAt)));
    if (only === 'ambiguous') return rtwCheckError('govuk', 'govuk_unreadable_date', checkedAt);
    rawUntil = only;
  }
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
): Promise<{ text: string; fullText: string; complete: boolean }> {
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

  // A result still drawing itself reads differently a second later.
  await page.waitForLoadState('load').catch(() => undefined);
  const root = await find(page, selectors.resultRoot);
  const text = root ? await root.innerText() : '';
  let fullText = text;
  try {
    const body = await find(page, [{ css: 'body' }]);
    if (body) fullText = await body.innerText();
  } catch {
    // the main text stands
  }
  return { text, fullText, complete: done.shareCode && done.dateOfBirth };
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
        const { text, fullText, complete } = await driveGovuk(page, input, config);
        if (!complete) {
          // A page reached without ever giving gov.uk the code AND the date
          // of birth is not an answer about this person, whatever it says —
          // it is never parsed (QA 25.09). Retried, then the office.
          return {
            result: rtwCheckError('govuk', 'govuk_page_changed:inputs', checkedAt),
            report: null,
          };
        }
        let result = parseGovukResult(text, checkedAt);
        // The end date is sometimes outside <main>: read the whole page
        // before giving up on it. Only a pass can replace the error.
        if (result.error === 'govuk_no_expiry' && fullText !== text) {
          const whole = parseGovukResult(fullText, checkedAt);
          if (whole.outcome === 'right_to_work') result = whole;
        }
        let report: Uint8Array | null = null;
        let photo: Uint8Array | null = null;
        // A page gov.uk answered but we could not read goes to the office
        // (`isResultPageRtwError`): they need gov.uk's own report to decide.
        if (
          result.outcome === 'right_to_work' ||
          result.outcome === 'no_right_to_work' ||
          (result.outcome === 'error' && isResultPageRtwError(result.error))
        ) {
          photo = await govukPhoto(page);
          const bytes = await page.pdf({ format: 'A4', printBackground: true });
          report = looksLikePdf(bytes) ? bytes : null;
        }
        const hint = result.error === 'govuk_no_expiry' ? pageHint(fullText || text, input) : null;
        return { result, report, photo, hint };
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
