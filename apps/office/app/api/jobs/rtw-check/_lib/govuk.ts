import {
  isResultPageRtwError,
  nameTokens,
  namesMatch,
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
  pdf(options: {
    format: string;
    printBackground: boolean;
    scale?: number;
    margin?: { top: string; right: string; bottom: string; left: string };
  }): Promise<Uint8Array>;
  /**
   * Optional, like `screenshot`: used only to tidy the report (`fitReportToOnePage`),
   * so a scripted test page need not implement them.
   */
  addStyleTag?(options: { content: string }): Promise<unknown>;
  emulateMedia?(options: { media: 'print' | 'screen' }): Promise<void>;
  setViewportSize?(size: { width: number; height: number }): Promise<void>;
  evaluate?(expression: string): Promise<unknown>;
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
 * carry a number or a date, for the office (see `CheckOutput.hint`). The
 * worker's name, date of birth and share code, and any long reference, are
 * replaced by ▢ — never dropped — so the LAYOUT of the page can be read
 * (where the name sits, what labels it) without the person being identified.
 * The page footer is dropped; a date alone on its line keeps the label above
 * it. At most eight lines of 100 characters.
 */
const HINT_STATUS_WORDS =
  /status|settled|permission|right to work|expir|time limit|indefinite|\bleave\b|visa|scheme|valid|until|condition|\bcan work\b|\bcannot work\b|\bname\b|birth|share code|reference/i;
const HINT_BOILERPLATE =
  /secure copy|open government licence|cookies?|privacy|accessibility statement|crown copyright|terms and conditions|skip to|\bmenu\b|\bfeedback\b/i;

function isBareDate(line: string): boolean {
  return (
    /\d/.test(line) &&
    line.replace(/[\d/.\-:,]|(?<=\d)(?:st|nd|rd|th)|[A-Za-z]{3,9}\.?(?=\s+\d)/g, '').trim() === ''
  );
}

/**
 * The record holder's name when the page has no recognisable "Name" label: the
 * shortest short line that carries BOTH the profile's first and last name (the
 * same test `decideRtwCheck` applies). A page naming someone else has no such
 * line, so the name stays missing and the check goes to the office.
 */
export function recordNameFromPage(text: string, names: readonly string[]): string | null {
  const [first, last] = names;
  if (!first || !last) return null;
  const found = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && l.length <= 80 && namesMatch(l, first, last));
  return found.sort((a, b) => a.length - b.length)[0] ?? null;
}

export function pageHint(text: string, input: CheckInput): string | null {
  const code = input.shareCode.replace(/\s+/g, '').toUpperCase();
  const names = new Set(
    (input.redact ?? []).flatMap((n) => nameTokens(n)).filter((n) => n.length > 1),
  );
  const dob = input.dateOfBirth.slice(0, 10);
  const mask = (line: string): string => {
    let out = line;
    if (code) out = out.replace(new RegExp(code.split('').join('\\s*'), 'gi'), '▢');
    for (const pattern of DATE_PATTERNS) {
      out = out.replace(pattern, (m, g: string) => (datesOnLine(g).includes(dob) ? '▢' : m));
    }
    out = out.replace(/[\p{L}][\p{L}'’-]*/gu, (w) =>
      nameTokens(w).some((t) => names.has(t)) ? '▢' : w,
    );
    return out.replace(/\b[A-Za-z0-9][A-Za-z0-9-]{7,}\b(?=\W|$)/g, (w) => (/\d/.test(w) ? '▢' : w));
  };
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const keep: string[] = [];
  for (let i = 0; i < lines.length && keep.length < 8; i += 1) {
    const raw = lines[i]!;
    if (!raw) continue;
    const masked = mask(raw);
    if (HINT_BOILERPLATE.test(masked)) continue;
    const bare = isBareDate(raw);
    if (!(masked.includes('▢') || /\d/.test(masked) || HINT_STATUS_WORDS.test(masked))) continue;
    // A label above a date alone on its line is shown with that date, once.
    if (!bare && isBareDate(lines[i + 1] ?? '')) continue;
    const prev = lines[i - 1] ? mask(lines[i - 1]!) : '';
    const shown = (bare && prev ? `${prev} ${masked}` : masked).slice(0, 100);
    if (!keep.includes(shown)) keep.push(shown);
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

// ---------------------------------------------------------------------
// The report: gov.uk's result page, printed on ONE A4 sheet.
// ---------------------------------------------------------------------

/** A4 in CSS px (96 dpi) and the 10 mm margin the report is printed with. */
const A4_PX = { width: 794, height: 1123 };
const MARGIN_MM = 10;
const MARGIN_PX = Math.round((MARGIN_MM / 25.4) * 96);
const MARGIN = `${MARGIN_MM}mm`;

/**
 * What is printed on the page but is not the result: the cookie banner (it
 * printed above the heading, ASSUMED class names — confirm on the live
 * service), the skip link, back link, beta/feedback banner and footer. The
 * GOV.UK header and everything in <main> stay. Kept in one place beside the
 * selectors, so a restyle is a one-line change.
 */
const REPORT_HIDE = [
  '#global-cookie-message',
  '.govuk-cookie-banner',
  '[class*="cookie-banner" i]',
  '[id*="cookie-banner" i]',
  '[aria-label*="cookies" i]',
  '.govuk-skip-link',
  '.govuk-back-link',
  '.govuk-phase-banner',
  '.govuk-footer',
  'footer',
].join(', ');

/**
 * Tidy the result page for printing and return the PDF options that put all
 * of it on one A4 sheet: the page furniture is hidden and the rest is scaled
 * down only as far as it needs to be (never up). Measured at the printable
 * width, which is narrower than a screen, so the height it reads is the real
 * one. Best effort: a page that cannot be tidied or measured prints as it was
 * — an untidy report beats none, and the checks never depend on it.
 */
export async function fitReportToOnePage(
  page: GovukPage,
): Promise<{
  scale?: number;
  margin: { top: string; right: string; bottom: string; left: string };
}> {
  const margin = { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN };
  try {
    await page.emulateMedia?.({ media: 'print' });
    await page.addStyleTag?.({ content: `${REPORT_HIDE} { display: none !important; }` });
    const width = A4_PX.width - 2 * MARGIN_PX;
    await page.setViewportSize?.({ width, height: A4_PX.height });
    const measured = await page.evaluate?.(
      'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)',
    );
    if (typeof measured !== 'number' || !Number.isFinite(measured) || measured <= 0)
      return { margin };
    const room = A4_PX.height - 2 * MARGIN_PX;
    // 3 % spare for rounding between the layout we measured and the one Chrome prints.
    const scale = Math.min(1, (room / measured) * 0.97);
    // Chrome's own floor is 0.1.
    return scale >= 1
      ? { margin }
      : { scale: Math.max(0.1, Math.floor(scale * 100) / 100), margin };
  } catch {
    return { margin };
  }
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
          const bytes = await page.pdf({
            format: 'A4',
            printBackground: true,
            ...(await fitReportToOnePage(page)),
          });
          report = looksLikePdf(bytes) ? bytes : null;
        }
        // No "Name" label found: look for the profile's own name on the page.
        if (result.outcome === 'right_to_work' && !result.fullName) {
          const found = recordNameFromPage(fullText || text, input.redact ?? []);
          if (found) result = { ...result, fullName: found };
        }
        const hint =
          result.error === 'govuk_no_expiry' ||
          (result.outcome === 'right_to_work' && !result.fullName)
            ? pageHint(fullText || text, input)
            : null;
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
