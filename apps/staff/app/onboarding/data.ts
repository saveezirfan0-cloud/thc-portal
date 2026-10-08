import { cookies } from 'next/headers';
import { StaffLoadError, staffDb, supabaseConfigured } from '../db';
import { mapOnboardingState } from './state';
import type { OnboardingState } from './state';
import type { HmrcGender } from '@thc/domain';

/**
 * What the eleven screens read — one RPC, `onboarding_state()`, which
 * resolves the caller from the session (20260923120000). Nothing here
 * names a worker.
 */

export { supabaseConfigured };

export async function loadOnboarding(): Promise<OnboardingState | null> {
  if (!supabaseConfigured()) return null;
  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('onboarding_state');
  // A failed read is not "we couldn't find your onboarding" (audit D18):
  // it goes to the error boundary, which offers the retry.
  if (error) throw new StaffLoadError(error.message || 'onboarding_state failed');
  return mapOnboardingState(data);
}

/**
 * The gender already on the caller's row (step 7 re-opened), through the
 * worker's own-row read. Null when unanswered or unreadable — the form
 * then asks, and the database refuses a checklist without it.
 */
export async function loadHmrcGender(staffId: string): Promise<HmrcGender | null> {
  if (!supabaseConfigured() || !staffId) return null;
  const supabase = staffDb(await cookies());
  const { data } = await supabase.from('staff').select('gender').eq('id', staffId).maybeSingle();
  const gender = (data as { gender?: unknown } | null)?.gender;
  return gender === 'M' || gender === 'F' ? gender : null;
}

/**
 * The languages already on the caller's row (step 2 re-opened, ADR-0080),
 * through the worker's own-row read. Null when never answered or
 * unreadable — the step then starts from English alone.
 */
export async function loadLanguages(staffId: string): Promise<string[] | null> {
  if (!supabaseConfigured() || !staffId) return null;
  const supabase = staffDb(await cookies());
  const { data } = await supabase.from('staff').select('languages').eq('id', staffId).maybeSingle();
  const languages = (data as { languages?: unknown } | null)?.languages;
  return Array.isArray(languages)
    ? languages.filter((l): l is string => typeof l === 'string')
    : null;
}

/**
 * Whether the caller is SpudBros Express staff whose THC shifts are not
 * switched on (ADR-0106), through the worker's own-row read. False when
 * unreadable: the ordinary last step then shows, which is the wording that
 * is wrong for them but never one that withholds anything.
 */
export async function loadOnboardingOnly(staffId: string): Promise<boolean> {
  if (!supabaseConfigured() || !staffId) return false;
  const supabase = staffDb(await cookies());
  const { data } = await supabase
    .from('staff')
    .select('spudbros_express, thc_shifts_enabled')
    .eq('id', staffId)
    .maybeSingle();
  const row = data as { spudbros_express?: unknown; thc_shifts_enabled?: unknown } | null;
  return row?.spudbros_express === true && row?.thc_shifts_enabled !== true;
}

export interface QuizQuestion {
  id: string;
  n: number;
  prompt: string;
  options: string[];
  /** A picture shown above the options (Q7's COSHH symbol), a path under /public. */
  image: string | null;
}

/**
 * The quiz WITHOUT its key (`onboarding_quiz_questions()`, 20260930140000).
 * Null when the database refuses — out of stage, before the induction, or
 * no attempts left — and the screen says so rather than guessing.
 */
export async function loadQuizQuestions(): Promise<QuizQuestion[] | null> {
  if (!supabaseConfigured()) return null;
  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('onboarding_quiz_questions');
  if (error) return null;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row['id']),
    n: Number(row['question_no']),
    prompt: String(row['prompt']),
    options: (row['options'] as string[]) ?? [],
    image: typeof row['image_path'] === 'string' ? row['image_path'] : null,
  }));
}
