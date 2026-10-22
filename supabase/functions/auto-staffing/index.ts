/**
 * auto-staffing — the three auto-assign rounds (§3.4, §3.5, §7).
 *
 *   ?mode=hourly      every hour at :17 — additive invitations for every
 *                     unfilled section whose shift has not started.
 *   ?mode=cutoff      the 12:05 UK deadline — drop confirmed workers who
 *                     never pressed "I'm ready", then re-fill. Every 5
 *                     minutes, all day: it also drops a worker who accepted
 *                     after that noon and has not pressed it within an
 *                     hour (ADR-0196).
 *   ?mode=escalation  every 10 minutes — sections already under way and
 *                     still short, ignoring the headcount + buffer cap,
 *                     inviting only within settings.escalation_radius_miles
 *                     of the venue (§3.4), as source = 'escalation'.
 *   &event=<uuid>     optional — only that event's sections. The office's
 *                     save posts `?mode=hourly&event=…` through
 *                     auto_assign_first_round() (20260928110200) so a new
 *                     event gets its first round "from the moment the
 *                     event is created" (§3.4) instead of at :17, without
 *                     handing every other open section an extra round.
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
 *   * the offer rounds (hourly only, ADR-0046) — `lapse_shift_offers`,
 *     `offer_rounds_due`, `offer_candidates`, `notify_offer_candidates`
 *     (pgTAP 720–724); who is pushed is `selectOfferRecipients`, the
 *     invitation ranking minus everyone already told, and the SQL re-checks
 *     every gate, the calendar and RULE-17's wave order at the insert
 *   * who marked the section unavailable — `auto_assign_unavailable`
 *     (pgTAP, 706; ADR-0043), overlaid on the pool by `selectInvitees`'
 *     `unavailable` option; `invite_worker` refuses the same workers at
 *     the insert for the 'auto' and 'escalation' sources
 *
 * What is left here is a loop. That is the point: nothing in this repo
 * type-checks or runs this file (docs/14 O5).
 */

import { runJob } from '../_shared/job.ts';
import {
  selectInvitees,
  selectOfferRecipients,
  type CandidateRow,
} from '../../../packages/domain/src/autoAssign.ts';
import { parseWeights } from '../../../packages/domain/src/scoring.ts';
import { readAllPages } from '../../../packages/db/src/paged.ts';
import type { PageReply } from '../../../packages/db/src/paged.ts';

/** Far past any directory THC will hold; past it a pool read is an error, never a cut. */
const POOL_CEILING = 20_000;

/** How many failures one run lists in job_runs.counts (all are counted). */
const MAX_FAILURES_LISTED = 20;

type Mode = 'hourly' | 'cutoff' | 'escalation';

const MODES: readonly Mode[] = ['hourly', 'cutoff', 'escalation'];

function modeOf(request: Request): Mode {
  const raw = new URL(request.url).searchParams.get('mode') ?? '';
  if ((MODES as readonly string[]).includes(raw)) return raw as Mode;
  throw new Error(`mode must be one of ${MODES.join(', ')}; got ${JSON.stringify(raw)}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one event a first round is scoped to, or null for the whole due list. */
function eventOf(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get('event');
  if (raw === null || raw === '') return null;
  if (!UUID.test(raw)) throw new Error(`event must be a uuid; got ${JSON.stringify(raw)}`);
  return raw.toLowerCase();
}

Deno.serve((request) =>
  runJob('auto-staffing', request, async (db) => {
    const mode = modeOf(request);
    const onlyEvent = eventOf(request);

    // The 12:05 cutoff is registered as an every-5-minute entry because
    // pg_cron is UTC and the deadline is UK wall-clock (§3.5). The run in
    // the 12:05 UK window releases and re-fills. Every other run is a retry
    // of it, so a failed 12:05 run is made good five minutes later instead of
    // never (20260929100000, ADR-0034): it calls release_unready_bookings(),
    // which is idempotent and never reaches a shift starting today under the
    // noon rule, and goes on to re-fill only if it released somebody.
    //
    // It runs at every hour, not just 12:05–midnight, because the same call
    // releases a worker who accepted after the noon deadline and has not
    // pressed "I'm ready" within an hour (ADR-0196) — and that hour can end
    // at any time, including after midnight.
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
        const { data: retried, error } = await db.rpc('release_unready_bookings');
        if (error) throw new Error(`release_unready_bookings: ${error.message}`);
        if (!retried) return { mode, retry: true, released: 0 };
        // Released by the retry, so the section has a gap: fall through to
        // the re-fill. The release below is idempotent and finds nothing.
      }
    }

    const counts: Record<string, unknown> = {
      mode,
      sections: 0,
      invited: 0,
      released: 0,
      // ADR-0043: candidates the round skipped because their availability
      // calendar overlaps the role section (never invited by the machine).
      unavailableSkipped: 0,
    };
    if (onlyEvent) counts.event = onlyEvent;

    // Per-section and per-offer failures (go-live audit H4): logged, counted
    // and listed (the first few) in job_runs, never a reason to stop the round.
    counts.failedSections = 0;
    counts.failedOffers = 0;
    const failures: { kind: string; id: string; error: string }[] = [];
    const failed = (kind: 'section' | 'offer', id: string, cause: unknown) => {
      const error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 300);
      console.error(`[auto-staffing] ${mode}: ${kind} ${id} failed`, { error });
      if (kind === 'section') counts.failedSections = (counts.failedSections as number) + 1;
      else counts.failedOffers = (counts.failedOffers as number) + 1;
      if (failures.length < MAX_FAILURES_LISTED) failures.push({ kind, id, error });
      counts.failures = failures;
    };

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

    // A first round (auto_assign_first_round) is one event's sections only;
    // the other open sections keep their hourly cadence.
    const sections = (
      (due ?? []) as { shift_id: string; event_id: string; allocation: number }[]
    ).filter((section) => onlyEvent === null || section.event_id === onlyEvent);

    for (const section of sections) {
      // Go-live audit H4: one section's failure — its pool hitting the 8 s
      // statement limit, one refused invite — used to throw out of the loop
      // and abort the whole round, so every later section (in starts_at
      // order) got nothing this hour, and every hour while it repeated.
      // Each section now stands alone: the failure is logged and counted in
      // job_runs (`failedSections`, `failures`) and the round goes on.
      try {
        // §3.4: the escalation pool is "every worker qualified for that role
        // within a 3-mile radius of the venue" — the radius is
        // settings.escalation_radius_miles, applied in SQL as the
        // `outside_radius` gate, which selectInvitees skips like any other.
        //
        // Only the gate-free rows, every one of them (go-live audit H5): a
        // gated row is never invited (rankPool drops it), and the unfiltered
        // pool is one row per worker in the directory — past PostgREST's
        // 1000-row cap at full roster, which silently dropped the same tail
        // of workers from every round. Paged by staff_id, which is unique
        // per row, because auto_assign_candidates has no ORDER BY of its own.
        const pool = await readAllPages<CandidateRow>(
          (range) =>
            db
              .rpc('auto_assign_candidates', {
                p_shift: section.shift_id,
                p_escalation: mode === 'escalation',
              })
              .is('gate', null)
              .order('staff_id')
              .range(range.from, range.to) as unknown as PromiseLike<PageReply<CandidateRow>>,
          { what: 'candidates', key: (row) => row.staff_id, ceiling: POOL_CEILING },
        );
        if (pool.error) throw new Error(`auto_assign_candidates: ${pool.error.message}`);

        // ADR-0043: the calendar is a hard gate on every round the machine
        // runs — hourly, first round, cutoff refill and escalation alike —
        // measured against this ROLE SECTION's window (RULE-18). It is not a
        // sixth score: the §6 weights are untouched and the workers are
        // simply skipped, like any other gate. A manager can still invite
        // them by hand from the board.
        const { data: away, error: awayError } = await db.rpc('auto_assign_unavailable', {
          p_shift: section.shift_id,
        });
        if (awayError) throw new Error(`auto_assign_unavailable: ${awayError.message}`);
        const unavailable = new Set(
          ((away ?? []) as { staff_id: string }[]).map((r) => r.staff_id),
        );
        const rows = pool.data;
        counts.unavailableSkipped =
          (counts.unavailableSkipped as number) +
          rows.filter(
            (row) =>
              row.gate === null && row.booking_status === null && unavailable.has(row.staff_id),
          ).length;

        const invitees = selectInvitees(rows, {
          allocation: section.allocation,
          weights,
          // §3.4: after the start, "proximity to the venue matters more than
          // the match score" — nearest first within each wave.
          proximityFirst: mode === 'escalation',
          unavailable,
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
      } catch (cause) {
        failed('section', section.shift_id, cause);
      }
    }

    // ADR-0046: the offer rounds, on the hourly run only (a first round for
    // one new event has no offers yet). First the lapse — anything past its
    // expiry closes and OF3 tells the worker they are still booked — then,
    // for every open pool offer on a section with auto-assign on, one
    // additive OF1 round of `allocation_per_hour`: wave 1 first, each by
    // the §6 score, never anyone already told, never the offerer, a gated
    // or an unavailable worker (ADR-0043).
    if (mode === 'hourly' && onlyEvent === null) {
      const { data: lapsed, error: lapseError } = await db.rpc('lapse_shift_offers');
      if (lapseError) throw new Error(`lapse_shift_offers: ${lapseError.message}`);
      counts.offersLapsed = lapsed ?? 0;
      counts.offers = 0;
      counts.offerPushes = 0;

      const { data: offers, error: offersError } = await db.rpc('offer_rounds_due');
      if (offersError) throw new Error(`offer_rounds_due: ${offersError.message}`);

      for (const offer of (offers ?? []) as {
        offer_id: string;
        shift_id: string;
        allocation: number;
      }[]) {
        // One offer's failure no longer stops the others (as for sections).
        try {
          const [pool, notices, away] = await Promise.all([
            // Gate-free rows only, every one of them, as for the sections.
            readAllPages<CandidateRow>(
              (range) =>
                db
                  .rpc('offer_candidates', { p_offer: offer.offer_id })
                  .is('gate', null)
                  .order('staff_id')
                  .range(range.from, range.to) as unknown as PromiseLike<PageReply<CandidateRow>>,
              { what: 'offer candidates', key: (row) => row.staff_id, ceiling: POOL_CEILING },
            ),
            // Everyone already told: a short list would push them twice.
            readAllPages<{ staff_id: string }>(
              (range) =>
                db
                  .from('shift_offer_notices')
                  .select('staff_id')
                  .eq('offer_id', offer.offer_id)
                  .order('staff_id')
                  .range(range.from, range.to) as unknown as PromiseLike<
                  PageReply<{ staff_id: string }>
                >,
              { what: 'offer notices', ceiling: POOL_CEILING },
            ),
            db.rpc('auto_assign_unavailable', { p_shift: offer.shift_id }),
          ]);
          if (pool.error) throw new Error(`offer_candidates: ${pool.error.message}`);
          if (notices.error) throw new Error(`shift_offer_notices: ${notices.error.message}`);
          if (away.error) throw new Error(`auto_assign_unavailable: ${away.error.message}`);

          const recipients = selectOfferRecipients(pool.data, {
            allocation: offer.allocation,
            notified: notices.data.map((n) => n.staff_id),
            unavailable: ((away.data ?? []) as { staff_id: string }[]).map((r) => r.staff_id),
            weights,
          });
          counts.offers = (counts.offers as number) + 1;
          if (recipients.length === 0) continue;

          const { data: pushed, error: pushError } = await db.rpc('notify_offer_candidates', {
            p_offer: offer.offer_id,
            p_staff: recipients,
          });
          if (pushError) throw new Error(`notify_offer_candidates: ${pushError.message}`);
          counts.offerPushes = (counts.offerPushes as number) + Number(pushed ?? 0);
        } catch (cause) {
          failed('offer', offer.offer_id, cause);
        }
      }
    }

    return counts;
  }),
);
