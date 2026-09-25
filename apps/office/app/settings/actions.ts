'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { settingsDb } from './db';
import { supabaseConfigured } from './data';
import {
  validateEscalationRadius,
  validateGap,
  validateRadius,
  validateSenders,
  validateWeights,
  validateWillo,
  validateWilloReviewUrlTemplate,
} from './validate';
import type { ActionResult, RotaGuardMode, ScoringWeights, Senders, WilloStageMap } from './types';

/**
 * Writes for /settings (§6, §2.4, §9.11, §9.12).
 *
 * Plain table writes, not RPCs: `settings` and `venue_types` each carry an
 * admin-only policy, so RLS is the gate and there is no rule to enforce in
 * SQL beyond "an admin may change this". A caller who is not an admin gets
 * a policy refusal, not a role check written here.
 *
 * Nothing on this screen is cached anywhere, and that is deliberate.
 * B14's acceptance test is "changing a weight changes auto-assign ranking
 * without a deployment" — so `auto-staffing` reads `scoring_weights` on
 * every run, and this write is the whole deployment.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so settings cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

async function put(key: string, value: unknown): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = settingsDb(await cookies());
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return { ok: false, message: error.message };
  revalidatePath('/settings');
  return { ok: true };
}

/**
 * §6's five factors. They must sum to 1.00 — see `validateWeights`, which
 * explains why a set that does not is a mistake nobody notices.
 *
 * The keys are the `settings` row's own spelling, which differs from the
 * scorer's interface; `parseWeights` in @thc/domain is what reconciles
 * them, and writing anything else here would leave every score NaN.
 */
export async function saveWeights(weights: ScoringWeights): Promise<ActionResult> {
  const invalid = validateWeights(weights);
  if (invalid) return { ok: false, message: invalid };
  return put('scoring_weights', weights);
}

/** §2.4, Appendix B. Editable "so a change to the Willo pipeline does not need a release". */
export async function saveWilloMap(map: WilloStageMap): Promise<ActionResult> {
  const invalid = validateWillo(map);
  if (invalid) return { ok: false, message: invalid };
  return put('willo_stage_map', map);
}

/**
 * §2.4: the "Review interview on Willo" link, the one B1 input the office
 * enters once THC's Willo account exists. Blank clears it: the row is
 * deleted rather than set to a JSON null, because `settings.value` is NOT
 * NULL and PostgREST turns a JSON null into a SQL one; with no row the
 * view's `jsonb_typeof(...) = 'string'` test is false and the link reads
 * "not connected", which is the truth.
 */
export async function saveWilloReviewUrlTemplate(value: string): Promise<ActionResult> {
  const invalid = validateWilloReviewUrlTemplate(value);
  if (invalid) return { ok: false, message: invalid };
  const template = value.trim();
  if (template !== '') return put('willo_review_url_template', template);

  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = settingsDb(await cookies());
  const { error } = await supabase.from('settings').delete().eq('key', 'willo_review_url_template');
  if (error) return { ok: false, message: error.message };
  revalidatePath('/settings');
  return { ok: true };
}

/** §9.12. Exactly two addresses, both reply-able. */
export async function saveSenders(senders: Senders): Promise<ActionResult> {
  const invalid = validateSenders(senders);
  if (invalid) return { ok: false, message: invalid };
  return put('senders', {
    timesheets: senders.timesheets.trim().toLowerCase(),
    admin: senders.admin.trim().toLowerCase(),
  });
}

/** RULE-06's different-venue gap and §3.4's escalation radius. */
export async function saveAutoAssignNumbers(
  gapMinutes: number,
  escalationMiles: number,
): Promise<ActionResult> {
  const invalid = validateGap(gapMinutes) ?? validateEscalationRadius(escalationMiles);
  if (invalid) return { ok: false, message: invalid };

  const gap = await put('booked_elsewhere_gap_minutes', gapMinutes);
  if (!gap.ok) return gap;
  return put('escalation_radius_miles', escalationMiles);
}

/**
 * Completion letter requirement §4: "Rota/scheduling engine must warn (or
 * block, configurable) when a shift assignment would breach the worker's
 * current cap." Only the Working Time 48 is configurable; the database
 * refuses a Student visa breach or a shift past the right to work whatever
 * this says, so there is no value here that could make one possible.
 */
export async function saveRotaGuardMode(mode: RotaGuardMode): Promise<ActionResult> {
  if (mode !== 'block' && mode !== 'warn') {
    return { ok: false, message: 'Choose block or warn.' };
  }
  const saved = await put('rota_guard_mode', mode);
  if (saved.ok) revalidatePath('/compliance');
  return saved;
}

/**
 * §9.11's standard radii — "these defaults are editable in Django Admin so
 * THC can tune them without a release".
 *
 * They are DEFAULTS. Changing one here pre-fills the slider for venues
 * created from now on; it does not move the geofence of a venue that has
 * already been set up, and it does not touch an event, which carries its
 * own radius copied at build time. The screen says so, because "editable
 * default" and "retroactive change" are indistinguishable from a form.
 */
export async function saveVenueRadius(
  key: string,
  label: string,
  metres: number,
): Promise<ActionResult> {
  const invalid = validateRadius(label, metres);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = settingsDb(await cookies());
  const { error } = await supabase
    .from('venue_types')
    .update({ default_radius_m: metres })
    .eq('key', key);
  if (error) return { ok: false, message: error.message };

  revalidatePath('/settings');
  revalidatePath('/venues');
  return { ok: true };
}
