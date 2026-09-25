import type { RtwCheckResult, RtwCheckSource } from '@thc/domain';

/**
 * The one interface both right-to-work adapters implement (ADR-0025,
 * superseding ADR-0002's "drop-in" promise):
 *
 *   provider  a third-party right-to-work provider's HTTP API — PRIMARY
 *   govuk     our own browser check of gov.uk/view-right-to-work — FALLBACK,
 *             used only when the provider errors (never when it returns a
 *             definitive "not found" or "no right to work")
 *
 * An adapter never throws for a failed check: it returns an `error` result
 * with a short code (`rtwCheckError`), so the orchestrator and the retry
 * rules see every failure the same way. The share code and the date of
 * birth are inputs only; nothing an adapter returns may carry them.
 */
export interface CheckInput {
  /** Normalised: upper case, no spaces (W123AB4CD). */
  shareCode: string;
  /** YYYY-MM-DD. */
  dateOfBirth: string;
  /** Who gov.uk is told is checking (settings.rtw_check.company_name). */
  companyName: string;
}

export interface CheckOutput {
  result: RtwCheckResult;
  /** The PDF report to store on the profile (§2.6), when the check produced one. */
  report: Uint8Array | null;
}

export interface RightToWorkChecker {
  readonly source: RtwCheckSource;
  check(input: CheckInput): Promise<CheckOutput>;
}

/** Reads one environment variable; injected so nothing here touches `process.env`. */
export type EnvReader = (name: string) => string | undefined;

export function envText(env: EnvReader, name: string): string | null {
  const value = env(name)?.trim();
  return value ? value : null;
}

export function envNumber(env: EnvReader, name: string, fallback: number): number {
  const value = Number(envText(env, name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 10 MB: the same ceiling as every other document in the bucket (§2.5 pt 7). */
export const MAX_REPORT_BYTES = 10 * 1024 * 1024;

/** A PDF starts with `%PDF-`. Anything else is not stored as the report. */
export function looksLikePdf(bytes: Uint8Array | null | undefined): bytes is Uint8Array {
  return (
    !!bytes &&
    bytes.length > 5 &&
    bytes.length <= MAX_REPORT_BYTES &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/**
 * A date as either service might print it — `2028-03-31`, `31/03/2028`,
 * `31-03-2028`, `31 March 2028`, `31 Mar 2028` — as YYYY-MM-DD, or null.
 * Day-first throughout: both services are British.
 */
export function parseUkDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(text))) {
    const name = match[2]!.toLowerCase();
    const month = Object.entries(MONTHS).find(([full]) => full.startsWith(name.slice(0, 3)));
    if (!month || (name.length > 3 && !month[0].startsWith(name))) return null;
    [d, m, y] = [Number(match[1]), month[1], Number(match[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Today's calendar day in the UK, YYYY-MM-DD (§1.8: rules run on UK days). */
export function ukToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
}
