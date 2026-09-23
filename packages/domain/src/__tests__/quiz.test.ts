import { describe, expect, it } from 'vitest';
import {
  QUIZ_ATTEMPTS,
  QUIZ_FAILED_COPY,
  attemptsLeft,
  isPass,
  quizOutcome,
  scoreQuiz,
} from '../quiz';

describe('H&S quiz marking (§2.9)', () => {
  it('80% is a pass — 8 of 10', () => {
    expect(isPass(8, 10)).toBe(true);
    expect(isPass(7, 10)).toBe(false);
  });

  it('is exact at the boundary, not floating point', () => {
    expect(isPass(12, 15)).toBe(true);
    expect(isPass(11, 15)).toBe(false);
    expect(isPass(4, 5)).toBe(true);
    expect(isPass(79, 99)).toBe(false); // 79.8%
  });

  it('never passes an empty quiz', () => {
    expect(isPass(0, 0)).toBe(false);
  });

  it('scores against the key; an unanswered question is wrong', () => {
    const key = { a: 1, b: 0, c: 2, d: 3, e: 0 };
    expect(scoreQuiz({ a: 1, b: 0, c: 2, d: 3, e: 0 }, key)).toEqual({
      correct: 5,
      total: 5,
      percent: 100,
      passed: true,
    });
    expect(scoreQuiz({ a: 1, b: 0, c: 2, d: 0 }, key)).toEqual({
      correct: 3,
      total: 5,
      percent: 60,
      passed: false,
    });
  });

  it('rounds the printed percent down, so 79.9% never reads as 80%', () => {
    const key = Object.fromEntries(Array.from({ length: 99 }, (_, i) => [`q${i}`, 0]));
    const answers = Object.fromEntries(
      Array.from({ length: 99 }, (_, i) => [`q${i}`, i < 79 ? 0 : 1]),
    );
    expect(scoreQuiz(answers, key).percent).toBe(79);
  });
});

describe('three attempts (§2.9, §2.12)', () => {
  it('a fail on attempts 1 and 2 is a retry', () => {
    expect(quizOutcome(1, false)).toBe('retry');
    expect(quizOutcome(2, false)).toBe('retry');
  });
  it('the third failure is the rejection', () => {
    expect(quizOutcome(QUIZ_ATTEMPTS, false)).toBe('rejected');
  });
  it('a pass on the third attempt is a pass', () => {
    expect(quizOutcome(3, true)).toBe('passed');
  });
  it('counts what is left', () => {
    expect(attemptsLeft(0)).toBe(3);
    expect(attemptsLeft(1)).toBe(2);
    expect(attemptsLeft(3)).toBe(0);
    expect(attemptsLeft(4)).toBe(0);
  });
});

describe('the terminal copy (§10.1 case 3)', () => {
  it('is THC’s wording, unparaphrased (E4 is held to it in apps/staff)', () => {
    expect(QUIZ_FAILED_COPY).toMatch(
      /^Unfortunately, you haven't passed the Health & Safety assessment after three attempts/,
    );
    expect(QUIZ_FAILED_COPY).toMatch(/any further at this time\.$/);
  });
});
