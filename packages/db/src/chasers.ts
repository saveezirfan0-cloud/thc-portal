/**
 * Onboarding chasers — the order of the calls (ADR-0071, 20261001212000).
 *
 * The rules are SQL and held by pgTAP 394: who is waiting on themselves,
 * whether a reminder is due (daily, never stopping), the daytime window.
 * `onboarding_chasers()` queues the OC1 interview emails and the OC3 wizard
 * pushes itself, and NAMES the OC2 activation reminders due, because an OC2
 * must carry a freshly minted activation link and SQL cannot mint one.
 *
 * This file is what is left: for each OC2 due, mint the link with the
 * office Accept's own code (`issueActivationLink`, provision.ts) and hand
 * it to `onboarding_chaser_activation()`, which queues the email.
 *
 * Minting replaces the candidate's previous token, so it happens only for a
 * row the database has just said is due, and the database re-checks before
 * it queues. A failure for one candidate is counted and logged, never
 * thrown: the OC1s and OC3s are already queued, and one bad login must not
 * hold up everyone else's reminder.
 *
 * Runs on Deno (supabase/functions/onboarding-chasers) and under vitest,
 * so it imports with `.ts` and touches nothing but its arguments.
 */
import type { IssuedLink } from './provision.ts';

/** One OC2 the database says is due (onboarding_chasers() → activation). */
export interface ActivationDue {
  staffId: string;
  userId: string | null;
  email: string;
  rung: number;
}

/** What onboarding_chasers() answers. */
export interface ChaserQueueAnswer {
  skipped?: string;
  oc1?: number;
  oc3?: number;
  activation?: ActivationDue[];
}

export interface ChaserSweepDeps {
  /** rpc('onboarding_chasers', { p_now }) */
  queue(): Promise<ChaserQueueAnswer>;
  /** issueActivationLink(admin, { email, userId }, STAFF_APP_URL) */
  issue(candidate: { email: string; userId: string }): Promise<IssuedLink>;
  /** rpc('onboarding_chaser_activation', …) → its `queued` */
  deliver(args: {
    staffId: string;
    userId: string;
    link: string;
    installLink: string;
  }): Promise<{ queued: boolean }>;
  log(level: 'info' | 'error', message: string, detail: Record<string, unknown>): void;
}

export interface ChaserSweepResult {
  skipped?: string;
  oc1: number;
  oc3: number;
  oc2_due: number;
  oc2_queued: number;
  oc2_not_due: number;
  oc2_failed: number;
}

export async function runChaserSweep(deps: ChaserSweepDeps): Promise<ChaserSweepResult> {
  const answer = await deps.queue();
  const result: ChaserSweepResult = {
    oc1: answer.oc1 ?? 0,
    oc3: answer.oc3 ?? 0,
    oc2_due: 0,
    oc2_queued: 0,
    oc2_not_due: 0,
    oc2_failed: 0,
  };
  if (answer.skipped) return { ...result, skipped: answer.skipped };

  const due = answer.activation ?? [];
  result.oc2_due = due.length;

  for (const row of due) {
    try {
      if (!row.userId) {
        // The database only names a candidate with a login; say so if not.
        deps.log('error', '[onboarding-chasers] activation due without a login', {
          staffId: row.staffId,
        });
        result.oc2_failed += 1;
        continue;
      }
      const issued = await deps.issue({ email: row.email, userId: row.userId });
      if (!issued.ok) {
        deps.log('error', '[onboarding-chasers] activation link not issued', {
          staffId: row.staffId,
          code: issued.code,
          detail: issued.detail,
        });
        result.oc2_failed += 1;
        continue;
      }
      const delivered = await deps.deliver({
        staffId: row.staffId,
        userId: issued.userId,
        link: issued.link,
        installLink: issued.installLink,
      });
      if (delivered.queued) result.oc2_queued += 1;
      else result.oc2_not_due += 1;
    } catch (cause) {
      deps.log('error', '[onboarding-chasers] activation reminder failed', {
        staffId: row.staffId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      result.oc2_failed += 1;
    }
  }
  return result;
}
