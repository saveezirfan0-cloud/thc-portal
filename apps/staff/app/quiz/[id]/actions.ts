'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { staffDb, supabaseConfigured } from '../../db';
import { refusalCopy } from './copy';

/**
 * Marking a client quiz (ADR-0110): the answers go to
 * `submit_client_quiz_attempt()` together and the database marks them
 * against a key this app never receives. What this file adds is the
 * sentence the worker reads when it refuses.
 */
export interface ClientQuizResult {
  attemptNo: number;
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
  attemptsLeft: number;
  outcome: 'passed' | 'retry' | 'failed';
}

export type SubmitResult =
  { ok: true; result: ClientQuizResult } | { ok: false; message: string; reason: string | null };

const NOT_CONFIGURED =
  'This environment has no Supabase project, so the quiz cannot be marked (docs/04-setup-github-vercel-supabase.md).';

export async function submitClientQuiz(
  quizId: string,
  answers: Record<string, number>,
): Promise<SubmitResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED, reason: null };
  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('submit_client_quiz_attempt', {
    p_quiz: quizId,
    p_answers: answers,
  });
  if (error) {
    const reason = /quiz_not_required|quiz_not_found/.test(error.message ?? '')
      ? 'quiz_not_required'
      : null;
    return { ok: false, message: refusalCopy(reason), reason };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  if (row['ok'] !== true) {
    const reason = typeof row['reason'] === 'string' ? (row['reason'] as string) : null;
    return { ok: false, message: refusalCopy(reason), reason };
  }
  // The result stays on the screen; the next visit to /shifts reads fresh.
  revalidatePath('/shifts');
  return {
    ok: true,
    result: {
      attemptNo: Number(row['attemptNo'] ?? 0),
      correct: Number(row['correct'] ?? 0),
      total: Number(row['total'] ?? 0),
      percent: Number(row['percent'] ?? 0),
      passed: row['passed'] === true,
      attemptsLeft: Number(row['attemptsLeft'] ?? 0),
      outcome: (row['outcome'] as ClientQuizResult['outcome']) ?? 'retry',
    },
  };
}
