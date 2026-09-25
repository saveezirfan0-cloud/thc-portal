import {
  assessRtwResult,
  redactRtwInputs,
  type RtwBranch,
  type RtwCheckOutcome,
} from '@thc/domain';
import type { GovUkInput, GovUkPage } from './govuk';
import { ExtractionError, type PageReading } from './extract';

/**
 * One run of the gov.uk share-code check (ADR-0025): claim one due check,
 * run it, record the result or the failure. Everything with a side effect
 * is passed in, so the order of operations and the failure handling are
 * tested without a browser, a network or a database (run.test.ts).
 *
 * The order is the point:
 *   1. claim (SKIP LOCKED — two overlapping runs never take one check)
 *   2. gov.uk, inside a hard time budget
 *   3. Claude reads the page
 *   4. @thc/domain decides what the office is shown
 *   5. the files go to the private bucket, THEN the row is recorded, so a
 *      recorded result never points at a file that is not there
 *
 * Any failure after the claim is recorded with fail_rtw_check(), redacted
 * of the share code and date of birth first. It is retried twice with
 * backoff by the database; the third failure leaves the document for the
 * office to check by hand.
 */

export interface ClaimedCheck {
  checkId: string;
  staffId: string;
  documentId: string;
  shareCode: string;
  dob: string;
  firstName: string;
  lastName: string;
  branch: RtwBranch | null;
  attempt: number;
}

export interface RecordArgs {
  checkId: string;
  outcome: RtwCheckOutcome;
  result: Record<string, unknown>;
  holderName: string | null;
  until: string | null;
  noTimeLimit: boolean;
  conditions: string | null;
  reportPath: string;
  photoPath: string | null;
}

export interface RunDeps {
  claim(): Promise<ClaimedCheck | null>;
  belowDegreeLevel(staffId: string): Promise<boolean>;
  checkGovUk(input: GovUkInput): Promise<GovUkPage>;
  readPage(pdf: Buffer): Promise<PageReading>;
  upload(path: string, bytes: Buffer, contentType: 'application/pdf' | 'image/png'): Promise<void>;
  record(args: RecordArgs): Promise<void>;
  fail(checkId: string, error: string, retryable: boolean): Promise<void>;
  companyName: string;
  /** UK date, YYYY-MM-DD. */
  today(): string;
  /** Whole-check budget; the browser and Claude both run inside it. */
  budgetMs: number;
}

export type RunResult =
  | { ran: false }
  | { ran: true; checkId: string; outcome: RtwCheckOutcome }
  | { ran: true; checkId: string; failed: true; retryable: boolean };

export class CheckTimeout extends Error {
  constructor(ms: number) {
    super(`the check took longer than ${Math.round(ms / 1000)} seconds`);
    this.name = 'CheckTimeout';
  }
}

function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CheckTimeout(ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Where a check's files live in the private `documents` bucket. */
export function checkPaths(staffId: string, checkId: string): { report: string; photo: string } {
  const base = `share-code-report/${staffId}/rtw-check-${checkId}`;
  return { report: `${base}.pdf`, photo: `${base}-photo.png` };
}

/** Which failures are worth another attempt. A page we do not recognise may be an outage. */
function retryable(cause: unknown): boolean {
  if (cause instanceof ExtractionError) return cause.retryable;
  return true;
}

export async function runOnce(deps: RunDeps): Promise<RunResult> {
  const check = await deps.claim();
  if (!check) return { ran: false };

  const work = runClaimed(deps, check);
  // If the budget wins the race the work is abandoned; its later failure
  // (the browser is closed under it) must not surface as an unhandled one.
  work.catch(() => undefined);
  try {
    const outcome = await withBudget(work, deps.budgetMs);
    return { ran: true, checkId: check.checkId, outcome };
  } catch (cause) {
    const raw = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    const message = redactRtwInputs(raw, { shareCode: check.shareCode, dob: check.dob }).slice(
      0,
      500,
    );
    const again = retryable(cause);
    await deps.fail(check.checkId, message, again);
    return { ran: true, checkId: check.checkId, failed: true, retryable: again };
  }
}

async function runClaimed(deps: RunDeps, check: ClaimedCheck): Promise<RtwCheckOutcome> {
  const page = await deps.checkGovUk({
    shareCode: check.shareCode,
    dob: check.dob,
    companyName: deps.companyName,
  });
  const reading = await deps.readPage(page.pdf);

  if (reading.pageKind === 'form_error' || reading.pageKind === 'other') {
    // Not an answer: the form came back, or the service showed something
    // else. Retried, because an outage looks exactly like this.
    throw new Error(`gov.uk did not return a result page (${reading.pageKind})`);
  }

  const assessment = assessRtwResult(
    {
      firstName: check.firstName,
      lastName: check.lastName,
      branch: check.branch,
      belowDegreeLevel: await deps.belowDegreeLevel(check.staffId),
    },
    { ...reading, found: reading.pageKind === 'result' && reading.found },
    deps.today(),
  );

  const paths = checkPaths(check.staffId, check.checkId);
  await deps.upload(paths.report, page.pdf, 'application/pdf');
  if (page.photo) await deps.upload(paths.photo, page.photo, 'image/png');

  const until = assessment.outcome === 'not_found' ? null : reading.rightToWorkUntil;
  await deps.record({
    checkId: check.checkId,
    outcome: assessment.outcome,
    // What the office sees beside the photo. Never the inputs: the table
    // refuses them, and they were never in `reading` to begin with.
    result: {
      pageKind: reading.pageKind,
      permissionType: reading.permissionType,
      termTimeWeeklyHours: reading.termTimeWeeklyHours,
      reasons: assessment.reasons,
    },
    holderName: reading.holderName,
    until: until !== null && /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : null,
    noTimeLimit: reading.noTimeLimit,
    conditions: reading.conditions,
    reportPath: paths.report,
    photoPath: page.photo ? paths.photo : null,
  });
  return assessment.outcome;
}
