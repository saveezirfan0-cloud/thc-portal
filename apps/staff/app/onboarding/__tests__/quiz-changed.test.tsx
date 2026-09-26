// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reasonCode, reasonMessage } from '../messages';

/**
 * 6/11 — the quiz replaced under a worker's feet (20260930140000).
 *
 * A worker who loaded THC's predecessor set and submits after the switch
 * sends answers keyed by question ids that are no longer active.
 * `submit_quiz_attempt()` refuses that as `quiz_changed` before writing
 * anything; the screen says so in words and reloads the current questions,
 * rather than telling them to "answer every question" they cannot see. A
 * retry after a failed attempt reloads them too, so it is never sat against
 * a stale set.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const submitQuiz = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({
  submitQuiz: (answers: Record<string, number>) => submitQuiz(answers),
}));

const { QuizStep } = await import('../_components/QuizStep');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = {
  id: 'old-placeholder-id',
  n: 1,
  prompt: 'What fire extinguisher from these listed would be utilised on an electrical fire?',
  options: ['Water', 'Foam', 'Carbon Dioxide'],
  image: null,
};

let container: HTMLDivElement;
let root: Root;

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button reads "${label}"`);
  return found;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the quiz_changed refusal (§2.9, 20260930140000)', () => {
  it('has its own sentence, not "answer every question"', () => {
    expect(reasonCode('quiz_changed')).toBe('quiz_changed');
    expect(reasonMessage('quiz_changed')).toBe(
      'The quiz has been updated — here are the current questions.',
    );
    expect(reasonMessage('quiz_incomplete')).toBe('Answer every question before you submit.');
    expect(reasonCode('something else entirely')).toBeNull();
  });

  it('on submit: shows the sentence and reloads the current questions', async () => {
    submitQuiz.mockResolvedValue({
      ok: false,
      message: reasonMessage('quiz_changed'),
      reason: 'quiz_changed',
    });
    act(() => {
      root.render(<QuizStep firstName="Amara" questions={[QUESTION]} previous={[]} />);
    });
    await click(container.querySelectorAll('.quiz-opt')[2]!);
    await click(button('Submit answers'));

    expect(submitQuiz).toHaveBeenCalledWith({ 'old-placeholder-id': 2 });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      'The quiz has been updated — here are the current questions.',
    );
    // The stale answer is dropped: the sheet starts again, unanswered.
    expect(container.querySelector('.quiz-opt.sel')).toBeNull();
    expect(button('Submit answers').disabled).toBe(true);
  });

  it('any other refusal is shown without a reload', async () => {
    submitQuiz.mockResolvedValue({
      ok: false,
      message: reasonMessage('quiz_incomplete'),
      reason: 'quiz_incomplete',
    });
    act(() => {
      root.render(<QuizStep firstName="Amara" questions={[QUESTION]} previous={[]} />);
    });
    await click(container.querySelectorAll('.quiz-opt')[0]!);
    await click(button('Submit answers'));

    expect(router.refresh).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Answer every question before you submit.');
  });

  it('"Try again" reloads the questions before the next attempt', async () => {
    act(() => {
      root.render(
        <QuizStep
          firstName="Amara"
          questions={[QUESTION]}
          previous={[{ attemptNo: 1, correct: 7, total: 10, passed: false }]}
          initialResult={{
            attemptNo: 1,
            correct: 7,
            total: 10,
            percent: 70,
            passed: false,
            outcome: 'retry',
            attemptsLeft: 2,
          }}
        />,
      );
    });
    await click(button('Try again — attempt 2 of 3'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Question 1 of 1');
  });
});
