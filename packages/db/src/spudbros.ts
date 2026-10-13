/**
 * SpudBros Express staff skip the Willo interview (ADR-0118,
 * 20261012150000) — the order of the calls.
 *
 * The rules are SQL and held by pgTAP 806: `spudbros_skip_due()` leases
 * every SpudBros candidate still awaiting the interview (with a backoff, so
 * the every-minute sweep and the nudge never mint two logins for one
 * person), and `spudbros_skip_interview()` links the login, moves them to
 * Documents and queues E3 in one transaction.
 *
 * What is left here: for each one leased, mint the login and the personal
 * link with the office Accept's own code (`issueActivationLink`,
 * provision.ts), then hand it to the database. A failure for one candidate
 * is recorded (`spudbros_skip_failed`) and counted, never thrown: the lease
 * retries them, and one bad login must not hold up anybody else.
 *
 * Runs on Deno (supabase/functions/willo-webhook, the `/invite` route) and
 * under vitest, so it imports with `.ts` and touches nothing but its
 * arguments.
 */
import type { IssuedLink } from './provision.ts';

/** A row of `spudbros_skip_due()`. */
export interface SkipDue {
  staff_id: string;
  email: string;
  user_id: string | null;
  attempt: number;
}

export interface SkipSweepDeps {
  /** rpc('spudbros_skip_due') */
  due(): Promise<SkipDue[]>;
  /** issueActivationLink(admin, { email, userId }, STAFF_APP_URL) */
  issue(candidate: { email: string; userId: string | null }): Promise<IssuedLink>;
  /** rpc('spudbros_skip_interview', …) → its `outcome` */
  skip(args: {
    staffId: string;
    userId: string;
    link: string;
    installLink: string;
  }): Promise<{ outcome: string }>;
  /** rpc('spudbros_skip_failed') */
  recordFailure(staffId: string, reason: string): Promise<void>;
  log(level: 'info' | 'error', message: string, detail: Record<string, unknown>): void;
}

export interface SkipSweepResult {
  spudbros_due: number;
  spudbros_moved: number;
  spudbros_unchanged: number;
  spudbros_failed: number;
}

export async function runSpudbrosSkipSweep(deps: SkipSweepDeps): Promise<SkipSweepResult> {
  const due = await deps.due();
  const result: SkipSweepResult = {
    spudbros_due: due.length,
    spudbros_moved: 0,
    spudbros_unchanged: 0,
    spudbros_failed: 0,
  };

  const fail = async (staffId: string, reason: string, detail: Record<string, unknown>) => {
    deps.log('error', '[spudbros-skip] not moved to Documents', { staffId, reason, ...detail });
    result.spudbros_failed += 1;
    try {
      await deps.recordFailure(staffId, reason);
    } catch (cause) {
      // Logged; the lease's backoff retries regardless.
      deps.log('error', '[spudbros-skip] could not record the failure', {
        staffId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  for (const row of due) {
    try {
      const issued = await deps.issue({ email: row.email, userId: row.user_id });
      if (!issued.ok) {
        await fail(row.staff_id, issued.code, { detail: issued.detail });
        continue;
      }
      const answer = await deps.skip({
        staffId: row.staff_id,
        userId: issued.userId,
        link: issued.link,
        installLink: issued.installLink,
      });
      if (answer.outcome === 'documents') result.spudbros_moved += 1;
      else result.spudbros_unchanged += 1;
    } catch (cause) {
      await fail(row.staff_id, cause instanceof Error ? cause.message : String(cause), {});
    }
  }
  return result;
}
