import { cache } from 'react';
import { cookies } from 'next/headers';
import { StaffLoadError, staffDb, supabaseConfigured } from '../db';
import { mapOnboardingState } from './state';
import type { OnboardingState } from './state';
import { NO_OWN_STAFF_FACTS, toOwnStaffFacts } from './own-staff-facts';
import type { OwnStaffFacts } from './own-staff-facts';

/**
 * What the eleven screens read — one RPC, `onboarding_state()`, which
 * resolves the caller from the session (20260923120000). Nothing here
 * names a worker.
 */

export { supabaseConfigured };

export const loadOnboarding = cache(async (): Promise<OnboardingState | null> => {
  if (!supabaseConfigured()) return null;
  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('onboarding_state');
  // A failed read is not "we couldn't find your onboarding" (audit D18):
  // it goes to the error boundary, which offers the retry.
  if (error) throw new StaffLoadError(error.message || 'onboarding_state failed');
  return mapOnboardingState(data);
});

/**
 * The caller's gender, languages and SpudBros Express pair
 * (`OwnStaffFacts`), through the worker's own-row read.
 *
 * One select, `React.cache`d per request (go-live audit M5). These were
 * three one-row selects of the same row, each behind the one before and
 * behind the photo's signature, so step 7 waited on four serial stages
 * after `onboarding_state()`. The step page now starts this alongside
 * the signature. Each column has its own select grant to `authenticated`
 * (20260923210000, 20261002108000, 20261008120000), so reading the four
 * together needs no privilege the three reads did not. A failed read
 * gives each field the fallback it always had (./own-staff-facts.ts).
 */
export const loadOwnStaffFacts = cache(async (staffId: string): Promise<OwnStaffFacts> => {
  if (!supabaseConfigured() || !staffId) return NO_OWN_STAFF_FACTS;
  const supabase = staffDb(await cookies());
  const { data } = await supabase
    .from('staff')
    .select('gender, languages, spudbros_express, thc_shifts_enabled')
    .eq('id', staffId)
    .maybeSingle();
  return toOwnStaffFacts(data as Record<string, unknown> | null);
});

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
