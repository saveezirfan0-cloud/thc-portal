'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { staffDb, supabaseConfigured } from '../db';
import { extractPostcode, lookupPostcode } from '../../lib/postcodes';
import { photoPathFor } from './photos';
import type { ActionResult } from './types';

/**
 * Everything a worker can change about themselves — §10.1, §10.6.
 *
 * Every write is one RPC. The rules they enforce — name and NI are locked,
 * the avatar is set once, a leaver's details are frozen, E5/E6/E7 are
 * queued in the same transaction as the save — live in
 * 20260922180000_staff_self_service.sql, because the Back Office reads the
 * same rows and a rule enforced only in a phone is not enforced.
 *
 * What this file adds is the sentence the worker sees for each refusal.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so nothing can be saved. See docs/04-setup-github-vercel-supabase.md.';

/**
 * The reason codes the RPCs raise, as sentences. Anything unmapped falls
 * through to its own message rather than a generic one — a refusal nobody
 * anticipated is worth seeing, not swallowing.
 */
const REASONS: Record<string, string> = {
  phone_required: 'Please enter a mobile number we can reach you on.',
  not_editable:
    'Your profile is closed to edits. If something needs correcting, contact the office at admin@thehospitalitycompany.co.uk.',
  invalid_ni: 'That doesn’t look like a National Insurance number. It should look like AB123456C.',
  ni_locked:
    'Your National Insurance number is already on file and is locked. Corrections go through the office.',
  photo_locked:
    'Your profile photo was set during onboarding and is locked. To change it, contact the office.',
  wrong_path: 'That upload didn’t go through. Please try again.',
  holder_required: 'Please enter the name on the account.',
  bad_sort_code: 'A sort code is six digits, e.g. 40-47-84.',
  bad_account_number: 'An account number is eight digits.',
  on_shift:
    'You’re checked in to a shift right now. Request my P45 is available once you’ve checked out.',
  unknown_staff: 'We couldn’t find your record. Please contact the office.',
};

async function db() {
  return staffDb(await cookies());
}

function message(raw: string): string {
  for (const [code, sentence] of Object.entries(REASONS)) {
    if (raw.includes(code)) return sentence;
  }
  return raw;
}

function refreshProfile() {
  revalidatePath('/profile');
  revalidatePath('/profile/details');
  revalidatePath('/profile/payments');
}

type Rpc = Record<string, unknown> | null;

async function call(fn: string, args: Record<string, string | null>): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await db();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: message(error.message) };
  refreshProfile();
  return { ok: true, ...noteFor(fn, data as Rpc) };
}

function noteFor(fn: string, _data: Rpc): { note?: string } {
  if (fn === 'staff_save_bank') {
    return {
      note: 'Saved. Changes apply from the next payroll run, and the office and payroll have been notified.',
    };
  }
  return {};
}

/**
 * Profile details — phone and home address (§10.1).
 *
 * An address change queues E7, then (ADR-0025) moves the worker's map pin
 * to the centre of the postcode in the new address, so the §6 proximity
 * score — and every distance the app prints — follows them rather than
 * going stale until the office finds time.
 *
 * Two RPCs, in this order, on purpose. `staff_update_contact()` saves the
 * address and queues E7 whatever happens next. Only then is postcodes.io
 * asked, and only then `staff_set_home_location_from_postcode()`, which
 * refuses any postcode not in the address it just saved. If there is no
 * postcode to find, or the lookup is unreachable, the address is still
 * saved, E7 is still queued, the old point stays, and the note says the
 * office will move the pin — which is what E7 asks of them anyway. The
 * save never fails on the pin.
 */
export async function saveContactDetails(
  phone: string,
  homeAddress: string,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await db();
  const { data, error } = await supabase.rpc('staff_update_contact', {
    p_phone: phone,
    p_home_address: homeAddress,
  });
  if (error) return { ok: false, message: message(error.message) };

  const changed = ((data as Rpc)?.['changed'] as string[]) ?? [];
  if (changed.length === 0) {
    refreshProfile();
    return { ok: true, note: 'Nothing had changed, so nothing was saved.' };
  }
  if (!changed.includes('home address')) {
    refreshProfile();
    return { ok: true, note: 'Saved.' };
  }

  // §10.1: an address change is reported to the office (E7). Saying so
  // is the difference between a worker thinking nothing happened and
  // knowing the office has been told.
  const pin = await followPostcode(supabase, homeAddress);
  refreshProfile();
  return {
    ok: true,
    note: `Saved. We’ve let the office and payroll know your address changed. ${pin}`,
  };
}

const PIN_STAYS = 'so your map pin stays where it was for now — the office will move it.';

/**
 * The second half of an address save (ADR-0025): the sentence about the
 * pin. Every branch is a sentence, never a failure — the address is
 * already saved and E7 already queued by the time this runs.
 */
async function followPostcode(
  supabase: Awaited<ReturnType<typeof db>>,
  homeAddress: string,
): Promise<string> {
  const postcode = extractPostcode(homeAddress);
  if (!postcode) return `We couldn’t find a UK postcode in it, ${PIN_STAYS}`;

  const found = await lookupPostcode(postcode);
  if (!found.ok) {
    return found.reason === 'unreachable'
      ? `Postcode lookup is unreachable right now, ${PIN_STAYS}`
      : `We couldn’t find ${postcode}, ${PIN_STAYS}`;
  }

  const { error } = await supabase.rpc('staff_set_home_location_from_postcode', {
    p_postcode: postcode,
    p_lat: found.lat,
    p_lng: found.lng,
  });
  if (error) return `Your map pin stays where it was for now — the office will move it.`;

  return `Your map pin now sits at the centre of ${postcode} — close enough for venue distances — and the office can fine-tune it.`;
}

/**
 * Step one of the email change (§10.1).
 *
 * Supabase Auth owns the code: `updateUser({ email })` sends a six-digit
 * confirmation to the NEW address and leaves the old one in place, which is
 * exactly the behaviour the scope asks for. Nothing on `staff` moves yet.
 */
export async function requestEmailChange(newEmail: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const email = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }
  const supabase = await db();
  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    note: `We sent a 6-digit code to ${email}. Your current email stays in place until you enter it.`,
  };
}

/**
 * Step two: the code. Only once Auth accepts it does `staff.email` move,
 * and E7 goes with it — so the office is told about a verified address and
 * never about an abandoned attempt.
 */
export async function confirmEmailChange(newEmail: string, code: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await db();
  const { error } = await supabase.auth.verifyOtp({
    email: newEmail.trim().toLowerCase(),
    token: code.trim(),
    type: 'email_change',
  });
  if (error) {
    return {
      ok: false,
      message: 'That code didn’t match, or it has expired. Ask for a new one and try again.',
    };
  }
  const { error: syncError } = await supabase.rpc('staff_sync_email', {});
  if (syncError) return { ok: false, message: message(syncError.message) };
  refreshProfile();
  return { ok: true, note: 'Your email address has been updated.' };
}

/** NI number — set once, and E6 when it is (§2.10). */
export async function saveNiNumber(ni: string): Promise<ActionResult> {
  return call('staff_set_ni_number', { p_ni: ni });
}

/** Bank & payroll — §2.10, §10.1. Always E5. */
export async function saveBankDetails(
  accountHolder: string,
  sortCode: string,
  accountNumber: string,
): Promise<ActionResult> {
  return call('staff_save_bank', {
    p_account_holder: accountHolder,
    p_sort_code: sortCode,
    p_account_number: accountNumber,
  });
}

/**
 * Security settings (§10.1). Supabase Auth re-checks the current password
 * by signing in with it first: `updateUser({ password })` alone would let
 * anyone holding an unlocked phone change it, which is the one thing a
 * "current password" field exists to prevent.
 */
export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (newPassword.length < 10 || !/[0-9]/.test(newPassword)) {
    return { ok: false, message: 'Use at least 10 characters, with a number.' };
  }
  const supabase = await db();
  const { error: wrong } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (wrong) return { ok: false, message: 'That current password isn’t right.' };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, message: error.message };
  return { ok: true, note: 'Password updated.' };
}

/** Sign out of every other device (§10.1's Signed-in devices row). */
export async function signOutOtherDevices(): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await db();
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) return { ok: false, message: error.message };
  return { ok: true, note: 'Signed out everywhere else.' };
}

export type PhotoSlot = { ok: true; path: string } | { ok: false; message: string };

/**
 * Where to put a selfie (§1.6).
 *
 * The browser is told the path, not allowed to choose it: it is
 * `<staffId>/…` built from the session here, which is what both
 * `photos_worker_insert_own` (20260922183015) and `staff_set_photo()`
 * check. The upload itself goes through the worker's own session, so
 * Storage RLS is the gate on it.
 *
 * §10.1 locks the avatar once it is set, so this refuses a worker who
 * already has one rather than handing out a path for an upload
 * `staff_set_photo()` would then reject.
 */
export async function startPhotoUpload(): Promise<PhotoSlot> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await db();
  const { data } = await supabase.rpc('staff_me');
  const me = data as Record<string, unknown> | null;
  if (!me) return { ok: false, message: REASONS['unknown_staff'] as string };
  if (me['photoLocked']) return { ok: false, message: REASONS['photo_locked'] as string };

  return { ok: true, path: photoPathFor(me['staffId'] as string) };
}

/** Attach an uploaded file to the profile. Refused if a photo already exists. */
export async function finishPhotoUpload(path: string): Promise<ActionResult> {
  return call('staff_set_photo', { p_path: path });
}

/**
 * §10.6. `request_my_p45()` takes no staff id — the subject is always the
 * caller's own row — and does the whole cascade: status → inactive with
 * `left_at` and the reason, every FUTURE booking released back to
 * auto-assign, open invitations and Radar applications withdrawn, a shift
 * already under way untouched, and E8 to the office immediately with the
 * list of released shifts.
 *
 * It refuses `on_shift` while the worker is checked in, which is the rule
 * behind the greyed-out button rather than a second copy of it.
 */
export async function requestP45(reason: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await db();
  const { error } = await supabase.rpc('request_my_p45', { p_reason: reason.trim() || null });
  if (error) return { ok: false, message: message(error.message) };

  // Everything the worker could still be looking at is now closed (§10.6
  // step 7), so every cached shell has to go, not just /profile.
  revalidatePath('/', 'layout');
  return { ok: true };
}
