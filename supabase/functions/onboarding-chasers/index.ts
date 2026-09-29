/**
 * onboarding-chasers — reminders to candidates who have stopped part-way
 * through onboarding (ADR-0071; an addition to scope v1.6 §8).
 *
 * Hourly. The rules are SQL (20261001212000) and held by pgTAP 394:
 * `onboarding_chasers()` decides who is waiting on themselves, whether a
 * reminder is due (daily, never stopping), and keeps every send inside the UK
 * daytime window; it queues the OC1 interview emails and the OC3 wizard
 * pushes. The OC2 activation reminder carries a freshly minted link, which
 * only GoTrue's admin API can make, so that part is here — in the order
 * `runChaserSweep` (packages/db/src/chasers.ts, held by vitest) fixes.
 *
 * Secrets (supabase secrets set …; never in code): STAFF_APP_URL — the
 * Staff App origin the link points at, the same one willo-webhook uses.
 * Without it no link is minted and every OC2 is counted as failed in
 * job_runs; OC1 and OC3 still go.
 */

import { runJob } from '../_shared/job.ts';
import { runChaserSweep } from '../../../packages/db/src/chasers.ts';
import type { ChaserQueueAnswer } from '../../../packages/db/src/chasers.ts';
import { issueActivationLink } from '../../../packages/db/src/provision.ts';
import type { AdminAuth } from '../../../packages/db/src/provision.ts';

Deno.serve((request) =>
  runJob('onboarding-chasers', request, async (db) => {
    const origin = Deno.env.get('STAFF_APP_URL') ?? '';
    const now = new Date().toISOString();

    const result = await runChaserSweep({
      queue: async () => {
        const { data, error } = await db.rpc('onboarding_chasers', { p_now: now });
        if (error) throw new Error(`onboarding_chasers: ${error.message}`);
        return (data ?? {}) as ChaserQueueAnswer;
      },
      issue: (candidate) =>
        issueActivationLink(db.auth.admin as unknown as AdminAuth, candidate, origin),
      deliver: async ({ staffId, userId, link, installLink }) => {
        const { data, error } = await db.rpc('onboarding_chaser_activation', {
          p_staff: staffId,
          p_user: userId,
          p_activation_link: link,
          p_install_link: installLink,
          p_now: now,
        });
        if (error) throw new Error(`onboarding_chaser_activation: ${error.message}`);
        return { queued: (data as { queued?: boolean } | null)?.queued === true };
      },
      log: (level, message, detail) =>
        level === 'error' ? console.error(message, detail) : console.log(message, detail),
    });

    return { ...result };
  }),
);
