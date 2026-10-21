/**
 * The holiday periods a reviewer confirms when they verify a University Term
 * Dates Letter (ADR-0178) — pure, so the candidate screen, the Needs review
 * dialog and the /staff/:id Documents tab share one set of rules and one set
 * of words, and each is tested without a browser.
 *
 * The periods are what the weekly cap is calculated from (RULE-20: 48 h in a
 * holiday week, 20 h — 10 below degree level — in term, the lower cap in a
 * week that straddles), and the last day on them is when the letter expires
 * (ADR-0103). So the reviewer can correct a date the AI read, remove one it
 * invented and add one it missed — and a letter verified with none at all is
 * an explicit, ticked decision, because it caps the worker all year.
 *
 * The wire form is the onboarding screen's: half-open `daterange` literals
 * (`periodToRange`), the same `p_term_dates` verify_document() and
 * compliance_verify_document() take.
 */
import { isRealIsoDate, termLetterFallbackExpiry, termLetterLastDay } from '@thc/domain';
import { parsePeriod, periodToRange, periodsProblem } from '../onboarding/view-model';
import type { Period } from '../onboarding/view-model';
import { ukDate, ukDay } from './queue';

export type { Period };

/**
 * One row of the editor. `read` is what the AI read for this row, kept so
 * the row can say whether the reviewer changed it; null for a row added by
 * hand. `key` is the React key, stable across edits and removals.
 */
export interface TermPeriod extends Period {
  key: string;
  read: Period | null;
}

export type PeriodSource = 'ai' | 'edited' | 'hand';

let counter = 0;
function nextKey(prefix: string): string {
  counter += 1;
  return `${prefix}${counter}`;
}

/** The letter's stored ranges as editor rows, in the order the AI read them. */
export function periodsFromLetter(ranges: readonly string[] | null | undefined): TermPeriod[] {
  return (ranges ?? []).flatMap((range) => {
    const period = parsePeriod(range);
    return period ? [{ ...period, read: { ...period }, key: nextKey('ai') }] : [];
  });
}

/** "+ Add period": an empty row the reviewer types into. */
export function blankPeriod(): TermPeriod {
  return { from: '', to: '', read: null, key: nextKey('hand') };
}

/** Whether a row is the AI's read as it was, the AI's read changed, or added by hand. */
export function periodSource(period: TermPeriod): PeriodSource {
  if (!period.read) return 'hand';
  return period.read.from === period.from && period.read.to === period.to ? 'ai' : 'edited';
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that is a day on the calendar (no 30 February). */
export function isCalendarDay(iso: string): boolean {
  return isRealIsoDate(iso);
}

/**
 * The longest a holiday period may run, in days, both ends counted: a year.
 * No holiday on a term letter is longer, so a longer one is a typed year
 * (17/01/2072 for 17/01/2027). Mirrors term_letter_periods_problem().
 */
export const MAX_PERIOD_DAYS = 366;

function inclusiveDays(period: Period): number {
  return (
    (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000 + 1
  );
}

/**
 * What is wrong with the periods, if anything — the onboarding screen's
 * words ("Period 2 needs both dates.", "Period 2 ends before it starts."),
 * plus a date that is not on the calendar, which only a hand-built request
 * can carry (the date field never applies one), and a period longer than a
 * year, which the database refuses too (ADR-0178).
 */
export function termPeriodsProblem(periods: readonly Period[]): string | null {
  for (const [index, period] of periods.entries()) {
    for (const day of [period.from, period.to]) {
      if (ISO_DAY.test(day) && !isCalendarDay(day)) {
        return `Period ${index + 1} has a date that is not on the calendar.`;
      }
    }
  }
  const shape = periodsProblem(periods);
  if (shape) return shape;
  for (const [index, period] of periods.entries()) {
    if (inclusiveDays(period) > MAX_PERIOD_DAYS) {
      return `Period ${index + 1} runs for more than a year — check the year of each date.`;
    }
  }
  return null;
}

/** The tick a letter with no holiday periods needs before it can be verified. */
export const NO_HOLIDAYS_TICK =
  'This letter shows no holidays. The worker will be limited to 20 hours a week (10 below degree level) all year.';

export const NO_HOLIDAYS_REQUIRED =
  'Tick to confirm the letter shows no holidays, or add the periods it shows.';

/**
 * The server-side half of the same rule, for the two Verify actions: the
 * periods must be complete and real, and none at all must have been ticked.
 */
export function termDatesPayloadProblem(
  periods: readonly Period[],
  noHolidaysConfirmed: boolean | undefined,
): string | null {
  const problem = termPeriodsProblem(periods);
  if (problem) return problem;
  if (periods.length === 0 && !noHolidaysConfirmed) return NO_HOLIDAYS_REQUIRED;
  return null;
}

/** The wire form: half-open `daterange` literals, from/to only. */
export function termDatesPayload(periods: readonly Period[]): string[] {
  return periods.map((period) => periodToRange({ from: period.from, to: period.to }));
}

/** Only complete, ordered periods count towards the letter's last day. */
function usable(periods: readonly Period[]): Period[] {
  return periods.filter((p) => isCalendarDay(p.from) && isCalendarDay(p.to) && p.to >= p.from);
}

export interface LetterExpiry {
  /** `YYYY-MM-DD`. */
  expiresOn: string;
  /** "Letter expires 17.01.2027 (last date on the letter)". */
  text: string;
  /** Set when the letter cannot be accepted on these dates — Verify would be refused. */
  problem: string | null;
}

/**
 * What the letter will do once verified with these periods (ADR-0103): it
 * expires on the last date on it, or — with none — on the calendar-year
 * fallback. `uploadedAt` is the upload's instant; `today` the UK day.
 * Mirrors doc_expires_on() and the database's refusal of a letter that has
 * already run out (`already_expired`, `term_letter_expired`).
 */
export function letterExpiry(
  periods: readonly Period[],
  uploadedAt: string,
  today: string,
): LetterExpiry {
  const ranges = usable(periods);
  const last = termLetterLastDay(ranges);
  const expiresOn = last ?? termLetterFallbackExpiry(ukDay(new Date(uploadedAt)));
  const text = last
    ? `Letter expires ${ukDate(last)} (last date on the letter)`
    : `Letter expires ${ukDate(expiresOn)} (no dates on the letter — calendar-year fallback)`;
  const problem =
    expiresOn <= today
      ? last
        ? `The last date on this letter is ${ukDate(last)}, so it has already run out and cannot be accepted. Correct the dates, or reject it and ask the worker for a current letter.`
        : `This letter would already have expired (${ukDate(expiresOn)}). Add the periods it shows, or reject it and ask the worker for a current letter.`
      : null;
  return { expiresOn, text, problem };
}

/** `16.08.2026–17.01.2027`. */
export function periodLabel(period: Period): string {
  return `${ukDate(period.from)}–${ukDate(period.to)}`;
}

/**
 * Said when the worker already has holiday dates on file from a previous
 * letter: verifying this one replaces them — the cap reads only the latest
 * verified letter's. Null when there are none, or the periods are the same.
 */
export function replacesPreviousLine(
  previous: readonly string[] | null | undefined,
  periods: readonly Period[],
): string | null {
  const before = (previous ?? []).flatMap((range) => {
    const period = parsePeriod(range);
    return period ? [period] : [];
  });
  if (before.length === 0) return null;
  const key = (list: readonly Period[]) =>
    list
      .map((p) => `${p.from}/${p.to}`)
      .sort()
      .join(',');
  if (key(before) === key(periods)) return null;
  const listed = before.map(periodLabel).join(' · ');
  return periods.length === 0
    ? `Verifying removes the holiday dates from their previous letter (${listed}). Every week will count as term time.`
    : `Verifying replaces the holiday dates from their previous letter (${listed}) with the ones above.`;
}

/**
 * Why Verify is not available yet on a term letter, or null when it is:
 * a period half typed or backwards, no periods and no tick, or dates that
 * have already run out.
 */
export function termLetterVerifyProblem({
  periods,
  noHolidaysConfirmed,
  uploadedAt,
  today,
}: {
  periods: readonly Period[];
  noHolidaysConfirmed: boolean;
  uploadedAt: string;
  today: string;
}): string | null {
  return (
    termDatesPayloadProblem(periods, noHolidaysConfirmed) ??
    letterExpiry(periods, uploadedAt, today).problem
  );
}

/** Whether the rows differ from what the letter was read as (the dialog's "discard changes?"). */
export function periodsEdited(
  periods: readonly TermPeriod[],
  ranges: readonly string[] | null | undefined,
): boolean {
  const read = periodsFromLetter(ranges);
  if (read.length !== periods.length) return true;
  return periods.some((period) => periodSource(period) !== 'ai');
}
