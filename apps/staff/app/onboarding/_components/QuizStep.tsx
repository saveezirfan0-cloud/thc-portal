'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, MobileList, MobileRow, Pill, Progress } from '@thc/ui';
import { QUIZ_ATTEMPTS, QUIZ_PASS_PERCENT } from '@thc/domain';
import { submitQuiz } from '../actions';
import type { QuizResult } from '../actions';
import type { QuizQuestion } from '../data';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 6/11 Safety quiz — §2.9, wireframes/staff/onboarding-2.html (question ·
 * passed · not passed · terminal).
 *
 * One answer per question, "checked at the end, not one by one": the
 * answers go to `submit_quiz_attempt()` together and the database marks
 * them against a key this app never receives. The third failure rejects
 * the candidate; /onboarding then shows the §10.1 case 3 terminal screen
 * with THC's wording, identical to E4.
 */
type Attempt = { attemptNo: number; correct: number; total: number; passed: boolean };

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function QuizStep({
  firstName,
  questions,
  previous,
  initialResult = null,
}: {
  firstName: string;
  questions: QuizQuestion[];
  previous: Attempt[];
  /** A result to open on — the three result states, renderable without a submit. */
  initialResult?: QuizResult | null;
}) {
  const router = useRouter();
  const [attempts, setAttempts] = useState<Attempt[]>(previous);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(initialResult);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const attemptNo = attempts.length + 1;
  const total = questions.length;
  const q = questions[index];

  function submit() {
    setError(null);
    start(async () => {
      const marked = await submitQuiz(answers);
      if (!marked.ok) return setError(marked.message);
      setResult(marked.result);
      setAttempts((a) => [...a, marked.result]);
      if (marked.result.outcome === 'rejected') router.push('/onboarding');
    });
  }

  function retry() {
    setAnswers({});
    setIndex(0);
    setResult(null);
  }

  const history = (
    <MobileList>
      {attempts.map((a) => (
        <MobileRow
          key={a.attemptNo}
          right={
            <span className={`mono sm ${a.passed ? 'green' : 'coral'}`}>
              {a.correct} / {a.total}
            </span>
          }
        >
          <span className="sm">
            Attempt {a.attemptNo} of {QUIZ_ATTEMPTS}
          </span>
        </MobileRow>
      ))}
    </MobileList>
  );

  if (result) {
    const passed = result.outcome === 'passed';
    return (
      <>
        <WizardTop step={6} />
        <div className="static-screen">
          <Pill tone={passed ? 'green' : 'coral'} large>
            {passed ? 'Passed' : 'Not passed'}
          </Pill>
          <div className={`score-big ${passed ? 'green' : 'coral'}`}>{result.percent}%</div>
          <h2>{passed ? `Well done, ${firstName}` : 'Not quite this time'}</h2>
          <p>
            {result.correct} of {result.total} correct —{' '}
            {passed ? (
              <>the pass mark is {QUIZ_PASS_PERCENT}%. Your result is saved on your profile.</>
            ) : (
              <>
                you need {QUIZ_PASS_PERCENT}%.{' '}
                <b className="amber">
                  You have {result.attemptsLeft}{' '}
                  {result.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.
                </b>{' '}
                Go back over the induction slides before you try again.
              </>
            )}
          </p>
        </div>
        {!passed && result.outcome === 'retry' ? (
          // Neutral, as the wireframe draws it: amber on this screen is
          // already "You have N attempts left."
          <Alert tone="neutral">
            After three unsuccessful attempts your application can’t continue.
          </Alert>
        ) : null}
        {history}
        <WizardFoot>
          {passed ? (
            <Button tone="primary" size="lg" block onClick={() => router.push('/onboarding/7')}>
              Continue
            </Button>
          ) : result.outcome === 'retry' ? (
            <>
              <Button tone="primary" size="lg" block onClick={retry}>
                Try again — attempt {result.attemptNo + 1} of {QUIZ_ATTEMPTS}
              </Button>
              <Link className="btn ghost block" href="/onboarding/5">
                Review the induction slides
              </Link>
            </>
          ) : (
            <Button tone="primary" size="lg" block disabled>
              Continue
            </Button>
          )}
        </WizardFoot>
      </>
    );
  }

  if (!q) {
    return (
      <>
        <WizardTop step={6} heading="Safety quiz" />
        <Alert tone="coral">The quiz isn’t available yet. Please contact the office.</Alert>
      </>
    );
  }

  const answered = answers[q.id] !== undefined;
  const last = index === total - 1;

  return (
    <>
      <WizardTop
        step={6}
        heading={`Question ${index + 1} of ${total}`}
        aside={
          <Pill className="ml-auto">
            Attempt {attemptNo} of {QUIZ_ATTEMPTS}
          </Pill>
        }
      />
      <Progress value={index + (answered ? 1 : 0)} max={total} tone="green" />
      <div className="q">{q.prompt}</div>
      <div role="radiogroup" aria-label={q.prompt} className="wiz-options">
        {q.options.map((option, i) => (
          <button
            type="button"
            role="radio"
            aria-checked={answers[q.id] === i}
            key={option}
            className={`quiz-opt ${answers[q.id] === i ? 'sel' : ''}`}
            onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
          >
            <span className="k">{LETTERS[i]}</span>
            <span>{option}</span>
          </button>
        ))}
      </div>
      <div className="xs muted">
        One answer per question. Pass mark {QUIZ_PASS_PERCENT}% (
        {Math.ceil((total * QUIZ_PASS_PERCENT) / 100)} of {total}). Your answers are checked at the
        end, not one by one.
      </div>
      {index > 0 ? (
        <button type="button" className="linkbtn" onClick={() => setIndex(index - 1)}>
          ‹ Previous question
        </button>
      ) : null}
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <WizardFoot hint={answered ? undefined : 'Choose an answer'}>
        {last ? (
          <Button tone="primary" size="lg" block disabled={!answered || pending} onClick={submit}>
            {pending ? 'Marking…' : 'Submit answers'}
          </Button>
        ) : (
          <Button
            tone="primary"
            size="lg"
            block
            disabled={!answered}
            onClick={() => setIndex(index + 1)}
          >
            Next question ›
          </Button>
        )}
      </WizardFoot>
    </>
  );
}
