import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { refusalCopy } from '../copy';
import { toClientQuiz } from '../data';

vi.mock('../actions', () => ({ submitClientQuiz: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { ClientQuiz, SlideView } = await import('../ClientQuiz');

/** ADR-0110 · `staff_client_quiz()` in the screen's shape, and the screens it opens on. */
const payload = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  title: 'Bar menu — Leonardo Royal Hotel London',
  intro: 'Read the bar menu and answer ten questions on it.',
  clientName: 'Leonardo Hotel St Pauls',
  roles: ['Bar Staff', 'Wine Waiting Service'],
  passMarkPercent: 80,
  maxAttempts: 3,
  attemptsUsed: 0,
  attemptsLeft: 3,
  passed: false,
  passedAt: null,
  failed: false,
  questionPool: 2,
  questionsPerAttempt: null,
  slides: [
    {
      heading: 'White wine',
      note: 'By the bottle and the 175ml glass.',
      columns: ['Bottle', 'Per 175ml'],
      rows: [
        ['Pinot Grigio delle Venezie, Corte Vigna', '£34.00', '£9.00'],
        ['Sancerre, Les Collinettes, Joseph Mellot', '£80.00', ''],
      ],
    },
    {
      heading: 'On the bill',
      note: 'A discretionary 12.5% service charge.',
      columns: [],
      rows: [],
    },
  ],
  questions: [
    {
      id: 'qq1',
      questionNo: 1,
      prompt: 'How much is a bottle of Pinot Grigio?',
      options: ['£30', '£34'],
    },
    {
      id: 'qq2',
      questionNo: 2,
      prompt: 'What size is a glass of still wine?',
      options: ['125ml', '175ml'],
    },
  ],
  attempts: [],
  ...over,
});

describe('toClientQuiz', () => {
  it('maps the quiz, its slides and its questions — with no key anywhere', () => {
    const quiz = toClientQuiz(payload());
    expect(quiz.title).toBe('Bar menu — Leonardo Royal Hotel London');
    expect(quiz.questionPool).toBe(2);
    expect(quiz.questionsPerAttempt).toBeNull();
    expect(quiz.roles).toEqual(['Bar Staff', 'Wine Waiting Service']);
    expect(quiz.slides[0]).toEqual({
      heading: 'White wine',
      note: 'By the bottle and the 175ml glass.',
      columns: ['Bottle', 'Per 175ml'],
      rows: [
        ['Pinot Grigio delle Venezie, Corte Vigna', '£34.00', '£9.00'],
        ['Sancerre, Les Collinettes, Joseph Mellot', '£80.00', ''],
      ],
    });
    expect(quiz.questions[1]).toEqual({
      id: 'qq2',
      n: 2,
      prompt: 'What size is a glass of still wine?',
      options: ['125ml', '175ml'],
    });
    expect(JSON.stringify(quiz)).not.toMatch(/correct/i);
  });

  it('reads the attempts', () => {
    const quiz = toClientQuiz(
      payload({
        attemptsUsed: 1,
        attemptsLeft: 2,
        attempts: [
          {
            attemptNo: 1,
            correct: 6,
            total: 10,
            percent: 60,
            passed: false,
            takenAt: '2026-10-08T10:00:00Z',
          },
        ],
      }),
    );
    expect(quiz.attempts).toEqual([
      {
        attemptNo: 1,
        correct: 6,
        total: 10,
        percent: 60,
        passed: false,
        takenAt: '2026-10-08T10:00:00Z',
      },
    ]);
  });
});

describe('refusalCopy', () => {
  it('has a sentence for every reason the database answers with', () => {
    for (const reason of [
      'incomplete',
      'quiz_changed',
      'already_passed',
      'no_attempts_left',
      'quiz_not_required',
    ])
      expect(refusalCopy(reason)).not.toMatch(/didn’t go through/);
    expect(refusalCopy('something_else')).toMatch(/didn’t go through/);
    expect(refusalCopy(null)).toMatch(/didn’t go through/);
  });
});

describe('ClientQuiz', () => {
  it('opens on the front page: the slides, the questions, the pass mark and a start button', () => {
    const markup = renderToStaticMarkup(
      <ClientQuiz quiz={toClientQuiz(payload())} firstName="Amy" />,
    );
    expect(markup).toContain('Before your first shift');
    expect(markup).toContain('2 slides');
    expect(markup).toContain('2 questions');
    expect(markup).toContain('pass mark 80% (2 of 2)');
    expect(markup).toContain('Attempt 1 of 3');
    expect(markup).toContain('Start — read the menu');
    expect(markup).not.toContain('dealt from a set');
  });

  it('says when the questions are dealt from a bigger pool (ADR-0111)', () => {
    const markup = renderToStaticMarkup(
      <ClientQuiz
        quiz={toClientQuiz(payload({ questionPool: 35, questionsPerAttempt: 2 }))}
        firstName="Amy"
      />,
    );
    expect(markup).toContain('2 questions');
    expect(markup).toContain('dealt from a set of 35');
  });

  it('opens on the passed screen once passed, for good', () => {
    const markup = renderToStaticMarkup(
      <ClientQuiz
        quiz={toClientQuiz(
          payload({
            passed: true,
            passedAt: '2026-10-08T10:00:00Z',
            attemptsUsed: 1,
            attempts: [
              {
                attemptNo: 1,
                correct: 2,
                total: 2,
                percent: 100,
                passed: true,
                takenAt: '2026-10-08T10:00:00Z',
              },
            ],
          }),
        )}
        firstName="Amy"
      />,
    );
    expect(markup).toContain('You’re all set, Amy');
    expect(markup).toContain(
      'cleared for Bar Staff and Wine Waiting Service shifts with Leonardo Hotel St Pauls',
    );
    expect(markup).toContain('Read the menu again');
    expect(markup).not.toContain('Start — read the menu');
  });

  it('opens on the failed screen with no attempts left', () => {
    const markup = renderToStaticMarkup(
      <ClientQuiz
        quiz={toClientQuiz(payload({ failed: true, attemptsUsed: 3, attemptsLeft: 0 }))}
        firstName={null}
      />,
    );
    expect(markup).toContain('No attempts left');
    expect(markup).toContain('The office has been told');
    expect(markup).not.toContain('Start — read the menu');
  });

  it('shows a result it is opened on', () => {
    const markup = renderToStaticMarkup(
      <ClientQuiz
        quiz={toClientQuiz(payload({ attemptsUsed: 1, attemptsLeft: 2 }))}
        firstName="Amy"
        initialResult={{
          attemptNo: 1,
          correct: 1,
          total: 2,
          percent: 50,
          passed: false,
          attemptsLeft: 2,
          outcome: 'retry',
        }}
      />,
    );
    expect(markup).toContain('Not quite this time');
    expect(markup).toContain('50%');
    expect(markup).toContain('You have 2 attempts left.');
    expect(markup).toContain('Try again — attempt 2 of 3');
  });
});

describe('SlideView', () => {
  it('draws a price list as a table, columns as headings', () => {
    const markup = renderToStaticMarkup(<SlideView slide={toClientQuiz(payload()).slides[0]!} />);
    expect(markup).toContain('<table class="menu-table">');
    expect(markup).toContain('Per 175ml');
    expect(markup).toContain('Sancerre, Les Collinettes, Joseph Mellot');
    expect(markup).toContain('£80.00');
  });

  it('draws a prose slide without a table', () => {
    const markup = renderToStaticMarkup(<SlideView slide={toClientQuiz(payload()).slides[1]!} />);
    expect(markup).not.toContain('<table');
    expect(markup).toContain('12.5% service charge');
  });
});
