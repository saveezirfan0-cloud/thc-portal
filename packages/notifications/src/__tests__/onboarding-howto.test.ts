import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEP_HOWTO, onboardingHowTo } from '../templates';

const here = new URL('.', import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, here), 'utf8');

/**
 * The step words onboarding_chaser_candidates() writes into `step`, read
 * from the latest migration that restates the `case` that names them (a patch
 * that leaves it alone, like 20261022150300, is skipped). A step the SQL adds
 * or renames without the register following would email "carry on with the
 * step the app shows you".
 */
function sqlStepWords(): string[] {
  const dir = new URL('../../../../supabase/migrations/', here);
  const latest = readdirSync(dir)
    .filter(
      (f) =>
        f.endsWith('.sql') &&
        /case k\.code[\s\S]*end as step\n/.test(readFileSync(new URL(f, dir), 'utf8')),
    )
    .sort()
    .pop();
  expect(latest, 'a migration that defines the step words').toBeDefined();
  const sql = readFileSync(new URL(latest!, dir), 'utf8');
  const block = sql.slice(sql.indexOf('case k.code'), sql.indexOf('end as step\n'));
  return [...block.matchAll(/when \d+\s+then '([^']+)'/g)].map((m) => m[1]!);
}

describe('OC4 instructions (ADR-0186)', () => {
  it('has a list for every step the chaser can name, and no other', () => {
    const words = sqlStepWords();
    expect(words).toHaveLength(11);
    expect(Object.keys(ONBOARDING_STEP_HOWTO).sort()).toEqual([...words].sort());
  });

  it('numbers the lines, starting with the one every step shares', () => {
    for (const step of Object.keys(ONBOARDING_STEP_HOWTO)) {
      const lines = onboardingHowTo(step).split('\n');
      expect(lines[0], step).toBe('1. Open the THC Staff App and sign in with this email address.');
      lines.forEach((line, i) => expect(line, step).toMatch(new RegExp(`^${i + 1}\\. \\S`)));
      expect(lines.length, step).toBeGreaterThanOrEqual(2);
      expect(lines.join('\n'), step).not.toMatch(/[{}]/);
    }
  });

  it('falls back to following the app for a step it does not know, or none', () => {
    for (const step of [undefined, '', 'something new', 'constructor', '__proto__']) {
      expect(onboardingHowTo(step)).toBe(
        '1. Open the THC Staff App and sign in with this email address.\n2. Carry on with the step the app shows you.',
      );
    }
  });

  it('quotes the quiz pass mark and attempts the quiz uses', () => {
    const quiz = read('../../../domain/src/quiz.ts');
    const pass = /QUIZ_PASS_PERCENT\s*=\s*(\d+)/.exec(quiz)?.[1];
    const attempts = /QUIZ_ATTEMPTS\s*=\s*(\d+)/.exec(quiz)?.[1];
    expect(pass).toBeDefined();
    expect(attempts).toBeDefined();
    expect(onboardingHowTo('the Health & Safety quiz')).toContain(
      `You need ${pass}% to pass, and you get ${attempts} attempts in all.`,
    );
  });
});
