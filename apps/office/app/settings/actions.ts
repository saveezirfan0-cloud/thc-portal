'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { type BufferSuggestionRule, bufferRuleProblem } from '@thc/domain';
import { isSwitchableCode } from '@thc/notifications';
import { READ_ONLY_MESSAGE } from '../_lib/sessionRole';
import { settingsDb } from './db';
import { supabaseConfigured } from './data';
import { mergeXero, validateXero } from '../api/xero/_lib/settings';
import type { XeroSettings } from '../api/xero/_lib/settings';
import {
  mergeInvoicing,
  validateClientPortalPhone,
  validateEscalationRadius,
  validateGap,
  validateInvoicing,
  validateRadius,
  validateSenders,
  validateSessionHours,
  validateWeights,
  validateWillo,
  validateWilloInterviewUrl,
  validateWilloReviewUrlTemplate,
} from './validate';
import type {
  ActionResult,
  InvoicingSettings,
  RotaGuardMode,
  ScoringWeights,
  Senders,
  WilloStageMap,
} from './types';

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

const SAVE_FAILED = 'That could not be saved. Try again, or ask an owner if it keeps happening.';

/**
 * A refused write as screen copy: the database's own text names policies
 * and columns, so it is logged here and never shown (security round 12.10).
 */
function saveRefusal(what: string, error: { code?: string; message: string }): ActionResult {
  if (/\bread_only\b/.test(error.message)) return { ok: false, message: READ_ONLY_MESSAGE };
  console.error(`[settings] ${what} failed`, { code: error.code, message: error.message });
  return { ok: false, message: SAVE_FAILED };
}

async function put(key: string, value: unknown): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = settingsDb(await cookies());
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return saveRefusal(key, error);
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
  return putOrClear('willo_review_url_template', value.trim());
}

/**
 * ADR-0149: the interview's public link, which the OC1 reminder email
 * carries. Blank clears it, the same way as the review template: no row, no
 * link in the email.
 */
export async function saveWilloInterviewUrl(value: string): Promise<ActionResult> {
  const invalid = validateWilloInterviewUrl(value);
  if (invalid) return { ok: false, message: invalid };
  return putOrClear('willo_interview_public_url', value.trim());
}

/** A non-blank string is saved; blank deletes the row (`settings.value` is NOT NULL). */
async function putOrClear(key: string, value: string): Promise<ActionResult> {
  if (value !== '') return put(key, value);

  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = settingsDb(await cookies());
  const { error } = await supabase.from('settings').delete().eq('key', key);
  if (error) return saveRefusal(key, error);
  revalidatePath('/settings');
  return { ok: true };
}

/** §9.12. Exactly two addresses, both reply-able. */
export async function saveSenders(senders: Senders): Promise<ActionResult> {
  const invalid = validateSenders(senders);
  if (invalid) return { ok: false, message: invalid };
  // All four keys are written together, so saving the senders can never
  // drop a reply-to; a blank one is left out (replies then go to the sender).
  const reply = (value: string | undefined) => value?.trim().toLowerCase() || undefined;
  const timesheetsReplyTo = reply(senders.timesheets_reply_to);
  const adminReplyTo = reply(senders.admin_reply_to);
  return put('senders', {
    timesheets: senders.timesheets.trim().toLowerCase(),
    admin: senders.admin.trim().toLowerCase(),
    ...(timesheetsReplyTo ? { timesheets_reply_to: timesheetsReplyTo } : {}),
    ...(adminReplyTo ? { admin_reply_to: adminReplyTo } : {}),
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
 * ADR-0181: the suggested buffer ("overs") the Shift Builder pre-fills on a
 * new role section. Exactly the six keys are written, whatever else the
 * caller sent; the database's guard refuses any other shape. A change
 * applies to role sections added from then on — a saved buffer is never
 * rewritten by it.
 */
export async function saveBufferSuggestion(rule: BufferSuggestionRule): Promise<ActionResult> {
  if (!rule || typeof rule !== 'object') return { ok: false, message: 'Nothing to save.' };
  const value: BufferSuggestionRule = {
    enabled: rule.enabled,
    per: rule.per,
    rounding: rule.rounding,
    from_headcount: rule.from_headcount,
    early_start_before: rule.early_start_before,
    early_start_extra: rule.early_start_extra,
  };
  const invalid = bufferRuleProblem(value);
  if (invalid) return { ok: false, message: invalid };
  return put('buffer_suggestion', value);
}

/**
 * ADR-0083: switch one notification on or off. Saved at once — a switch
 * that waits for a Save button reads as done when it is not.
 *
 * The row holds only the codes that are OFF ({"BG08": false}); switching
 * one back on drops its key. Read, change one key, write: two owners
 * flicking different switches in the same instant could lose one, and the
 * screen re-reads after every save, so the loser sees the switch where it
 * really is.
 */
export async function saveNotificationSwitch(code: string, on: boolean): Promise<ActionResult> {
  if (!isSwitchableCode(code)) return { ok: false, message: `${code} is not a notification.` };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = settingsDb(await cookies());
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'notification_switches')
    .maybeSingle();
  if (error) return saveRefusal('notification_switches', error);

  const current: unknown = data?.value;
  const off: Record<string, false> = {};
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (value === false) off[key] = false;
    }
  }
  if (on) delete off[code];
  else off[code] = false;

  return put('notification_switches', off);
}

/**
 * ADR-0134 N1: THC's on-the-day phone number on the Client Portal's event
 * page. Blank is saved as an empty string, which the portal's view reads as
 * "no number" and hides the line.
 */
export async function saveClientPortalPhone(value: string): Promise<ActionResult> {
  const invalid = validateClientPortalPhone(value);
  if (invalid) return { ok: false, message: invalid };
  return put('client_portal_phone', value.trim());
}

/**
 * ADR-0164 (audit H1, M4): two-step sign-in compulsory for every Back
 * Office login, and how long one sign-in lasts. Both rows are written
 * together; the settings_audit trigger records who changed what.
 *
 * Turning two-step off, or lengthening a sign-in, takes effect for the
 * database at once and for the middleware within a minute (ADR-0108's
 * recheck). Switching it on sends every office login without an
 * authenticator to the enrol step on its next page.
 */
export async function saveOfficeSignIn(
  twoStepRequired: boolean,
  sessionMaxHours: number,
): Promise<ActionResult> {
  if (typeof twoStepRequired !== 'boolean') {
    return { ok: false, message: 'Choose whether two-step sign-in is required.' };
  }
  const invalid = validateSessionHours(sessionMaxHours);
  if (invalid) return { ok: false, message: invalid };
  const hours = await put('office_session_max_hours', sessionMaxHours);
  if (!hours.ok) return hours;
  return put('office_two_step_required', twoStepRequired);
}

/**
 * ADR-0176: the invoice the system issues and emails — its send time, go-live
 * date, VAT, terms, PO window, and THC's company and bank details as printed.
 *
 * The whole `invoicing` object is written back, laid over the stored row so
 * a key this screen does not edit survives. Read, merge, write — the same as
 * the notification switches. Each invoice snapshots these values as it is
 * issued, so a change applies to invoices from the next run on and never
 * alters one already sent.
 */
export async function saveInvoicing(settings: InvoicingSettings): Promise<ActionResult> {
  if (!settings || typeof settings !== 'object') {
    return { ok: false, message: 'Nothing to save.' };
  }
  const invalid = validateInvoicing(settings);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = settingsDb(await cookies());
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'invoicing')
    .maybeSingle();
  if (error) return saveRefusal('invoicing', error);

  return put('invoicing', mergeInvoicing(data?.value, settings));
}

/**
 * ADR-0211: settings.xero — the switch, the first invoice number pushed, the
 * status Xero gets, the sales account and tax type, and whether the PDF is
 * attached. Laid over the stored row so a key this screen does not edit
 * survives. Connecting to Xero is not here: it is /api/xero/connect.
 */
export async function saveXero(settings: XeroSettings): Promise<ActionResult> {
  if (!settings || typeof settings !== 'object') {
    return { ok: false, message: 'Nothing to save.' };
  }
  const invalid = validateXero(settings);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = settingsDb(await cookies());
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'xero')
    .maybeSingle();
  if (error) return saveRefusal('xero', error);

  return put('xero', mergeXero(data?.value, settings));
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
  if (error) return saveRefusal(`venue_types.${key}`, error);

  revalidatePath('/settings');
  revalidatePath('/venues');
  return { ok: true };
}
