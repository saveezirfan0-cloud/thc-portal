/**
 * onboarding-chasers — reminders to candidates who have stopped part-way
 * through onboarding (ADR-0071; an addition to scope v1.6 §8).
 *
 * Hourly. The rules are SQL (20261001212000) and held by pgTAP 394:
 * `onboarding_chasers()` decides who is waiting on themselves, whether a
 * reminder is due (daily, never stopping), and keeps every send inside the UK
 * daytime window; it queues the OC1 interview emails and the OC3 wizard
 * pushes, or the same reminder by email (OC4, ADR-0169) to a candidate with
 * no device that has notifications on. The OC2 activation reminder carries a freshly minted link, which
 * only GoTrue's admin API can make, so that part is here — in the order
 * `runChaserSweep` (packages/db/src/chasers.ts, held by vitest) fixes.
 *
 * The same run then queues IR1, the daily reminder to everyone on the THC
 * invite list who has not applied yet (ADR-0122, 20261013160000;
 * `invite_roster_reminders()`, pgTAP 811), with `<STAFF_APP_URL>/apply` as
 * its button.
 *
 * Secrets (supabase secrets set …; never in code): STAFF_APP_URL — the
 * Staff App origin the link points at, the same one willo-webhook uses.
 * Without it no link is minted and every OC2 is counted as failed in
 * job_runs and every OC3 stays a push; OC1 and OC3 still go.
 */

import { runJob } from '../_shared/job.ts';
import { runChaserSweep } from '../../../packages/db/src/chasers.ts';
import type { ChaserQueueAnswer } from '../../../packages/db/src/chasers.ts';
import { issueActivationLink } from '../../../packages/db/src/provision.ts';
import type { AdminAuth } from '../../../packages/db/src/provision.ts';
import { staffAppOrigin } from '../../../packages/db/src/origin.ts';

Deno.serve((request) =>
  runJob('onboarding-chasers', request, async (db) => {
    // As typed: a bare host reads as https (staffAppOrigin, 13.10.2026).
    const origin = staffAppOrigin(Deno.env.get('STAFF_APP_URL')) ?? '';
    const now = new Date().toISOString();

    const result = await runChaserSweep({
      queue: async () => {
        // ADR-0169: an OC3 for a candidate with notifications off goes as
        // an email (OC4) with this link; without it, every OC3 is a push.
        const { data, error } = await db.rpc('onboarding_chasers', {
          p_now: now,
          p_app_link: origin ? `${origin}/onboarding` : null,
        });
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

    // ADR-0122: the daily IR1 reminder to THC invite-list rows not yet
    // applied. Queued after the sweep, so a failure here (job_runs shows it)
    // never holds an OC reminder back. The button is the ordinary /apply
    // link; with no STAFF_APP_URL the SQL queues nothing and says so.
    const { data: invites, error: invitesError } = await db.rpc('invite_roster_reminders', {
      p_now: now,
      p_apply_link: origin ? `${origin}/apply` : null,
    });
    if (invitesError) throw new Error(`invite_roster_reminders: ${invitesError.message}`);

    return { ...result, invites };
  }),
);
