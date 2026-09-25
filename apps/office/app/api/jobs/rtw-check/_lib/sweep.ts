import { decideRtwCheck, rtwCheckError, safeErrorCode } from '@thc/domain';
import type { RtwBranch, RtwCheckDecision, RtwCheckResult, RtwCheckSource } from '@thc/domain';
import { ukToday } from './checker';
import type { CheckInput, CheckOutput, RightToWorkChecker } from './checker';

/**
 * The runner's logic, with every piece of I/O injected (ADR-0025):
 *
 *   claim   → rtw_check_claim()           leases due checks (service role)
 *   check   → provider, then gov.uk        the orchestrator below
 *   decide  → decideRtwCheck()             packages/domain
 *   upload  → documents/<staff>/share-code-report/rtw-check-<id>.pdf
 *   record  → rtw_check_record()           which applies it, authoritatively
 *
 * Nothing here logs a share code, a date of birth or a name: log lines carry
 * the check id, the source and the outcome only.
 */

// ---------------------------------------------------------------------
// Orchestration: provider first, gov.uk when the provider errors.
// ---------------------------------------------------------------------

async function safeCheck(checker: RightToWorkChecker, input: CheckInput): Promise<CheckOutput> {
  try {
    return await checker.check(input);
  } catch (cause) {
    // Adapters return errors rather than throwing; this is the backstop,
    // and it keeps only the error's class name.
    return {
      result: rtwCheckError(
        checker.source,
        `${checker.source}_threw_${cause instanceof Error ? cause.name : 'error'}`,
      ),
      report: null,
    };
  }
}

/** A result that settles the check: anything but an error, and a pass only with its report. */
function settles(output: CheckOutput): boolean {
  if (output.result.outcome === 'error') return false;
  if (output.result.outcome === 'right_to_work' && !output.report) return false;
  return true;
}

/**
 * THC's rule (ADR-0025): the fallback runs when the primary ERRORS — or
 * passes without the report §2.6 stores — never when the primary returns a
 * definitive "not found" or "no right to work".
 */
export async function runOrchestrated(
  primary: RightToWorkChecker | null,
  fallback: RightToWorkChecker | null,
  input: CheckInput,
): Promise<CheckOutput & { tried: RtwCheckSource[] }> {
  const tried: RtwCheckSource[] = [];
  let first: CheckOutput | null = null;
  if (primary) {
    tried.push(primary.source);
    first = await safeCheck(primary, input);
    if (settles(first)) return { ...first, tried };
  }
  if (fallback && fallback !== primary) {
    tried.push(fallback.source);
    const second = await safeCheck(fallback, input);
    if (settles(second) || !first) return { ...second, tried };
    // Neither settled: keep the more informative of the two — a pass
    // without its report over an error, and the later error over the earlier.
    const kept =
      second.result.outcome !== 'error'
        ? second
        : first.result.outcome !== 'error'
          ? first
          : second;
    return { ...kept, tried };
  }
  return first
    ? { ...first, tried }
    : { result: rtwCheckError('provider', 'not_configured'), report: null, tried };
}

// ---------------------------------------------------------------------
// The sweep.
// ---------------------------------------------------------------------

/** One row of rtw_check_claim(). */
export interface ClaimedCheck {
  check_id: string;
  staff_id: string;
  document_id: string;
  attempt: number;
  max_attempts: number;
  share_code: string;
  date_of_birth: string;
  first_name: string;
  last_name: string;
  rtw_branch: string | null;
  below_degree_level: boolean;
}

export interface RecordInput {
  checkId: string;
  result: RtwCheckResult;
  decision: RtwCheckDecision;
  reportPath: string | null;
  error: string | null;
}

export interface SweepDeps {
  primary: RightToWorkChecker | null;
  fallback: RightToWorkChecker | null;
  companyName: string;
  limit: number;
  claim(limit: number): Promise<ClaimedCheck[]>;
  uploadReport(path: string, bytes: Uint8Array): Promise<void>;
  record(input: RecordInput): Promise<{ status: string }>;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface SweepCounts {
  [key: string]: number | string;
  claimed: number;
  passed: number;
  rejected: number;
  needs_review: number;
  queued: number;
  failed: number;
  record_errors: number;
}

/** Where a check's report lives: under the worker, as every document does. */
export function reportPath(staffId: string, checkId: string): string {
  return `${staffId}/share-code-report/rtw-check-${checkId}.pdf`;
}

const BRANCHES: readonly RtwBranch[] = [
  'uk_irish',
  'eu_settled',
  'work_visa',
  'international_student',
  'dependant_other',
];

export async function runRtwCheckSweep(
  deps: SweepDeps,
): Promise<SweepCounts | { skipped: string }> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date());

  // Without an adapter nothing is claimed, so no attempt is spent: every
  // waiting check runs on the first sweep that has one (as the Willo sweep
  // does without its keys, ADR-0021).
  if (!deps.primary && !deps.fallback) {
    log('rtw-check: no provider and gov.uk disabled — nothing claimed');
    return { skipped: 'not_configured' };
  }

  const counts: SweepCounts = {
    claimed: 0,
    passed: 0,
    rejected: 0,
    needs_review: 0,
    queued: 0,
    failed: 0,
    record_errors: 0,
  };
  const claimed = await deps.claim(deps.limit);
  counts.claimed = claimed.length;

  for (const row of claimed) {
    const input: CheckInput = {
      shareCode: row.share_code,
      dateOfBirth: String(row.date_of_birth).slice(0, 10),
      companyName: deps.companyName,
    };
    const output = await runOrchestrated(deps.primary, deps.fallback, input);
    let decision = decideRtwCheck(
      output.result,
      {
        firstName: row.first_name,
        lastName: row.last_name,
        rtwBranch: BRANCHES.includes(row.rtw_branch as RtwBranch)
          ? (row.rtw_branch as RtwBranch)
          : null,
        belowDegreeLevel: row.below_degree_level,
      },
      { attempt: row.attempt, maxAttempts: row.max_attempts, today: ukToday(now()) },
    );

    let path: string | null = null;
    if (output.report) {
      const target = reportPath(row.staff_id, row.check_id);
      try {
        await deps.uploadReport(target, output.report);
        path = target;
      } catch {
        log(`rtw-check ${row.check_id}: report upload failed`);
        // §2.6 stores the report; a pass is not complete without it.
        if (decision.action === 'verify')
          decision = { action: 'retry', error: 'report_upload_failed' };
      }
    }

    try {
      const recorded = await deps.record({
        checkId: row.check_id,
        result: output.result,
        decision,
        reportPath: path,
        error: output.result.outcome === 'error' ? safeErrorCode(output.result.error ?? '') : null,
      });
      const key = recorded.status as keyof SweepCounts;
      if (typeof counts[key] === 'number') (counts[key] as number) += 1;
      log(
        `rtw-check ${row.check_id}: ${output.tried.join('→')} ${output.result.outcome} → ${decision.action} → ${recorded.status}`,
      );
    } catch {
      // The lease lapses and the next sweep runs it again (attempt + 1).
      counts.record_errors += 1;
      log(`rtw-check ${row.check_id}: record failed; retried when the lease lapses`);
    }
  }
  return counts;
}
