/**
 * auto-staffing — the three auto-assign rounds (§3.4, §3.5, §7).
 *
 *   ?mode=hourly      every hour at :17 — additive invitations for every
 *                     unfilled section whose shift has not started.
 *   ?mode=cutoff      the 12:05 UK deadline — drop confirmed workers who
 *                     never pressed "I'm ready", then re-fill.
 *   ?mode=escalation  every 10 minutes — sections already under way and
 *                     still short, ignoring the headcount + buffer cap,
 *                     inviting only within settings.escalation_radius_miles
 *                     of the venue (§3.4), as source = 'escalation'.
 *
 * Everything decidable lives elsewhere and is tested:
 *
 *   * who is eligible — `auto_assign_candidates` (pgTAP, 130); with
 *     `p_escalation` it also gates anyone outside the escalation radius
 *     (pgTAP, 591), so the radius is read from settings in SQL, not here
 *   * who to invite, in what order — `selectInvitees` in packages/domain
 *     (vitest), which is also what the event board ranks with, so the
 *     board and the engine cannot disagree about who is top of the list
 *   * whether an invitation may be written at all — `invite_worker`,
 *     which re-applies every gate at the moment of the insert and locks
 *     the section so two rounds cannot take the same last slot
 *   * whether it is the right UK minute — `is_uk_time` (pgTAP, 180)
 *
 * What is left here is a loop. That is the point: nothing in this repo
 * type-checks or runs this file (docs/14 O5).
 */

import { runJob } from '../_shared/job.ts';
import { selectInvitees, type CandidateRow } from '../../../packages/domain/src/autoAssign.ts';
import { parseWeights } from '../../../packages/domain/src/scoring.ts';

type Mode = 'hourly' | 'cutoff' | 'escalation';

const MODES: readonly Mode[] = ['hourly', 'cutoff', 'escalation'];

function modeOf(request: Request): Mode {
  const raw = new URL(request.url).searchParams.get('mode') ?? '';
  if ((MODES as readonly string[]).includes(raw)) return raw as Mode;
  throw new Error(`mode must be one of ${MODES.join(', ')}; got ${JSON.stringify(raw)}`);
}

Deno.serve((request) =>
  runJob('auto-staffing', request, async (db) => {
    const mode = modeOf(request);

    // The 12:05 cutoff is registered as an every-5-minute entry because
    // pg_cron is UTC and the deadline is UK wall-clock (§3.5). The run in
    // the 12:05 UK window releases and re-fills. Every later run until UK
    // midnight is a retry of it, so a failed 12:05 run is made good five
    // minutes later instead of never (20260929100000, ADR-0030): it calls
    // release_unready_bookings(), which is idempotent and never reaches a
    // shift starting today, and goes on to re-fill only if it released
    // somebody. Before 12:05 nothing runs.
    if (mode === 'cutoff') {
      const ukFrom1205 = async (window: string) => {
        const { data, error } = await db.rpc('is_uk_time', {
          p_now: new Date().toISOString(),
          p_hhmm: '12:05',
          p_window: window,
        });
        if (error) throw new Error(`is_uk_time: ${error.message}`);
        return data === true;
      };
      if (!(await ukFrom1205('5 minutes'))) {
        if (!(await ukFrom1205('11 hours 55 minutes'))) {
          return { mode, skipped: 'before the 12:05 UK cutoff' };
        }
        const { data: retried, error } = await db.rpc('release_unready_bookings');
        if (error) throw new Error(`release_unready_bookings: ${error.message}`);
        if (!retried) return { mode, retry: true, released: 0 };
        // Released by the retry, so the section has a gap: fall through to
        // the re-fill. The release below is idempotent and finds nothing.
      }
    }

    const counts: Record<string, unknown> = { mode, sections: 0, invited: 0, released: 0 };

    if (mode === 'cutoff') {
      const { data: released, error } = await db.rpc('release_unready_bookings');
      if (error) throw new Error(`release_unready_bookings: ${error.message}`);
      counts.released = released ?? 0;
    }

    // §6's weights are editable in settings; the shipped default applies
    // when the row is missing or malformed.
    const { data: setting } = await db
      .from('settings')
      .select('value')
      .eq('key', 'scoring_weights')
      .maybeSingle();
    const weights = parseWeights(setting?.value);

    // The cutoff re-fills on the same rules as the hourly round: what it
    // has just released is a gap like any other.
    const dueMode = mode === 'escalation' ? 'escalation' : 'hourly';
    const { data: due, error: dueError } = await db.rpc('auto_assign_due_shifts', {
      p_mode: dueMode,
    });
    if (dueError) throw new Error(`auto_assign_due_shifts: ${dueError.message}`);

    for (const section of (due ?? []) as { shift_id: string; allocation: number }[]) {
      // §3.4: the escalation pool is "every worker qualified for that role
      // within a 3-mile radius of the venue" — the radius is
      // settings.escalation_radius_miles, applied in SQL as the
      // `outside_radius` gate, which selectInvitees skips like any other.
      const { data: pool, error: poolError } = await db.rpc('auto_assign_candidates', {
        p_shift: section.shift_id,
        p_escalation: mode === 'escalation',
      });
      if (poolError) throw new Error(`auto_assign_candidates: ${poolError.message}`);

      const invitees = selectInvitees((pool ?? []) as CandidateRow[], {
        allocation: section.allocation,
        weights,
        // §3.4: after the start, "proximity to the venue matters more than
        // the match score" — nearest first within each wave.
        proximityFirst: mode === 'escalation',
      });

      for (const staffId of invitees) {
        const { data: result, error: inviteError } = await db.rpc('invite_worker', {
          p_shift: section.shift_id,
          p_staff: staffId,
          // 'escalation' also makes invite_worker re-check the radius at
          // the insert, and records how the replacement was found.
          p_source: mode === 'escalation' ? 'escalation' : 'auto',
          // §3.4: escalation invites "ignoring the headcount + buffer cap".
          // Never set by the hourly round, which is what keeps the cap
          // meaningful before a shift starts.
          p_ignore_target: mode === 'escalation',
        });
        if (inviteError) throw new Error(`invite_worker: ${inviteError.message}`);
        if (result?.invited === true) counts.invited = (counts.invited as number) + 1;
      }

      counts.sections = (counts.sections as number) + 1;
    }

    return counts;
  }),
);
