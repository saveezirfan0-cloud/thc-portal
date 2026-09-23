/**
 * The Health & Safety quiz — Scope §2.9, §2.12, §10.1 case 3.
 *
 *   · pass mark 80% ("the pass mark for this is 80%", THC's own deck);
 *   · three attempts in total;
 *   · failing the third moves the candidate to `rejected`, sends E4 and
 *     replaces the wizard with the terminal screen.
 *
 * Scoring is the database's (`submit_quiz_attempt()`, 20260923120000): the
 * answer key never leaves it, so a worker cannot pass by reading the page.
 * This module is the same arithmetic for the screens that render a result
 * and for the tests that hold the SQL to it.
 */

/** §2.9. Expressed as a fraction so 8/10 is exactly the pass mark. */
export const QUIZ_PASS_NUMERATOR = 4;
export const QUIZ_PASS_DENOMINATOR = 5;
export const QUIZ_PASS_PERCENT = 80;
export const QUIZ_ATTEMPTS = 3;

export interface QuizScore {
  correct: number;
  total: number;
  /** Whole percent, rounded down — 79.9% is not a pass and must not print as 80%. */
  percent: number;
  passed: boolean;
}

/**
 * Integer comparison, not floating point: correct / total ≥ 4/5 is
 * correct × 5 ≥ total × 4. With 0.8 as a float, 12/15 is 0.7999… on some
 * paths and a worker who met the pass mark would be failed by rounding.
 */
export function isPass(correct: number, total: number): boolean {
  if (total <= 0) return false;
  return correct * QUIZ_PASS_DENOMINATOR >= total * QUIZ_PASS_NUMERATOR;
}

export function scoreQuiz(
  answers: Readonly<Record<string, number | null | undefined>>,
  key: Readonly<Record<string, number>>,
): QuizScore {
  const ids = Object.keys(key);
  const total = ids.length;
  const correct = ids.filter((id) => answers[id] === key[id]).length;
  return {
    correct,
    total,
    percent: total === 0 ? 0 : Math.floor((correct * 100) / total),
    passed: isPass(correct, total),
  };
}

export type QuizOutcome = 'passed' | 'retry' | 'rejected';

/**
 * What an attempt leads to. `attemptNo` is 1-based and includes the attempt
 * being marked. A pass on the third attempt is a pass.
 */
export function quizOutcome(attemptNo: number, passed: boolean): QuizOutcome {
  if (passed) return 'passed';
  return attemptNo >= QUIZ_ATTEMPTS ? 'rejected' : 'retry';
}

export function attemptsLeft(attemptsTaken: number): number {
  return Math.max(QUIZ_ATTEMPTS - attemptsTaken, 0);
}

/**
 * The terminal copy — §10.1 case 3 — word for word, and identical to E4.
 * `packages/notifications` carries the same text as E4's body; the test
 * asserts they match.
 */
export const QUIZ_FAILED_TITLE = 'Health & Safety Assessment — Unsuccessful';
export const QUIZ_FAILED_COPY =
  "Unfortunately, you haven't passed the Health & Safety assessment after three attempts, which is the maximum number permitted at this stage. As passing this assessment is a required part of onboarding, we're unable to progress your application any further at this time.";
