import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from '../../db';

/**
 * One client quiz for the worker (ADR-0108) — `staff_client_quiz()`.
 *
 * The slides are the material (a menu, section by section, as small
 * tables), the questions come WITHOUT their key, and the worker's standing
 * comes with them so the screen can open on the right state: not started,
 * a result to show, passed, or no attempts left.
 */
export interface QuizSlide {
  heading: string;
  note: string | null;
  columns: string[];
  rows: string[][];
}

export interface ClientQuizQuestion {
  id: string;
  n: number;
  prompt: string;
  options: string[];
}

export interface ClientQuizAttempt {
  attemptNo: number;
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
  takenAt: string;
}

export interface ClientQuiz {
  id: string;
  title: string;
  intro: string | null;
  clientName: string;
  roles: string[];
  passMarkPercent: number;
  maxAttempts: number;
  attemptsUsed: number;
  attemptsLeft: number;
  passed: boolean;
  passedAt: string | null;
  failed: boolean;
  slides: QuizSlide[];
  questions: ClientQuizQuestion[];
  attempts: ClientQuizAttempt[];
}

export interface QuizRead {
  quiz: ClientQuiz | null;
  /** The read failed, or the quiz is not the caller's to see. */
  problem: string | null;
  /** `quiz_not_required`: no booking of theirs names it — a 404, not an error. */
  notFound: boolean;
}

export async function loadClientQuiz(quizId: string): Promise<QuizRead> {
  if (!supabaseConfigured()) return { quiz: null, problem: null, notFound: false };
  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('staff_client_quiz', { p_quiz: quizId });
  if (error) {
    const notFound = /quiz_not_required|quiz_not_found/.test(error.message ?? '');
    return { quiz: null, problem: notFound ? null : error.message, notFound };
  }
  if (!data || typeof data !== 'object') return { quiz: null, problem: null, notFound: true };
  return { quiz: toClientQuiz(data as Record<string, unknown>), problem: null, notFound: false };
}

/** `staff_client_quiz()` in the screen's shape. */
export function toClientQuiz(row: Record<string, unknown>): ClientQuiz {
  const str = (key: string): string | null =>
    typeof row[key] === 'string' ? (row[key] as string) : null;
  const slides = ((row['slides'] as Record<string, unknown>[] | null) ?? []).map((s) => ({
    heading: String(s['heading'] ?? ''),
    note: typeof s['note'] === 'string' ? (s['note'] as string) : null,
    columns: ((s['columns'] as unknown[] | null) ?? []).map(String),
    rows: ((s['rows'] as unknown[][] | null) ?? []).map((r) => (r ?? []).map(String)),
  }));
  const questions = ((row['questions'] as Record<string, unknown>[] | null) ?? []).map((q) => ({
    id: String(q['id']),
    n: Number(q['questionNo'] ?? 0),
    prompt: String(q['prompt'] ?? ''),
    options: ((q['options'] as unknown[] | null) ?? []).map(String),
  }));
  const attempts = ((row['attempts'] as Record<string, unknown>[] | null) ?? []).map((a) => ({
    attemptNo: Number(a['attemptNo'] ?? 0),
    correct: Number(a['correct'] ?? 0),
    total: Number(a['total'] ?? 0),
    percent: Number(a['percent'] ?? 0),
    passed: a['passed'] === true,
    takenAt: String(a['takenAt'] ?? ''),
  }));
  return {
    id: String(row['id']),
    title: str('title') ?? '',
    intro: str('intro'),
    clientName: str('clientName') ?? '',
    roles: ((row['roles'] as unknown[] | null) ?? []).map(String),
    passMarkPercent: Number(row['passMarkPercent'] ?? 80),
    maxAttempts: Number(row['maxAttempts'] ?? 3),
    attemptsUsed: Number(row['attemptsUsed'] ?? 0),
    attemptsLeft: Number(row['attemptsLeft'] ?? 0),
    passed: row['passed'] === true,
    passedAt: str('passedAt'),
    failed: row['failed'] === true,
    slides,
    questions,
    attempts,
  };
}
