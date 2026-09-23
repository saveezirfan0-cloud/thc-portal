import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from '../db';
import { mapOnboardingState } from './state';
import type { OnboardingState } from './state';

/**
 * What the eleven screens read — one RPC, `onboarding_state()`, which
 * resolves the caller from the session (20260923120000). Nothing here
 * names a worker.
 */

export { supabaseConfigured };

export async function loadOnboarding(): Promise<OnboardingState | null> {
  if (!supabaseConfigured()) return null;
  const supabase = staffDb(await cookies());
  const { data } = await supabase.rpc('onboarding_state');
  return mapOnboardingState(data);
}

export interface QuizQuestion {
  id: string;
  n: number;
  prompt: string;
  options: string[];
}

/**
 * The quiz WITHOUT its key (`onboarding_quiz_questions()`, 20260923120100).
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
  }));
}
