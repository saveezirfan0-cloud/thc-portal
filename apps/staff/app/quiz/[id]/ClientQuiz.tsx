'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, MobileList, MobileRow, Pill, Progress } from '@thc/ui';
import { submitClientQuiz } from './actions';
import type { ClientQuizResult } from './actions';
import type { ClientQuiz as Quiz, QuizSlide } from './data';

/**
 * A client's quiz (ADR-0110), in the shape of the onboarding quiz the
 * worker has already sat (§10.3 steps 5–6): the material slide by slide,
 * the questions one at a time, the answers checked at the end.
 *
 * Four screens: the front page, the slides (the questions unlock on the
 * last one), the questions, and the result. A pass is for good — the quiz
 * opens on the passed screen from then on, with the slides still readable.
 * No attempts left opens on the failed screen: the office has been told.
 */
type Phase = 'front' | 'slides' | 'questions' | 'result';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function ClientQuiz({
  quiz,
  firstName,
  initialResult = null,
}: {
  quiz: Quiz;
  firstName: string | null;
  /** A result to open on — the result states, renderable without a submit. */
  initialResult?: ClientQuizResult | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initialResult ? 'result' : 'front');
  const [slide, setSlide] = useState(0);
  const [seenLast, setSeenLast] = useState(quiz.slides.length <= 1);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ClientQuizResult | null>(initialResult);
  const [attempts, setAttempts] = useState(quiz.attempts);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const total = quiz.questions.length;
  const passMark = Math.ceil((total * quiz.passMarkPercent) / 100);
  const attemptNo = attempts.length + 1;
  // ADR-0111: dealt from a bigger pool — the next sitting asks different ones.
  const rotates = quiz.questionsPerAttempt !== null && quiz.questionPool > total;

  function goSlide(to: number) {
    const next = Math.max(0, Math.min(quiz.slides.length - 1, to));
    setSlide(next);
    if (next === quiz.slides.length - 1) setSeenLast(true);
  }

  function submit() {
    setError(null);
    start(async () => {
      const marked = await submitClientQuiz(quiz.id, answers);
      if (!marked.ok) {
        setError(marked.message);
        if (marked.reason === 'quiz_changed') {
          setAnswers({});
          setIndex(0);
          router.refresh();
        }
        return;
      }
      setResult(marked.result);
      setAttempts((a) => [
        ...a,
        {
          attemptNo: marked.result.attemptNo,
          correct: marked.result.correct,
          total: marked.result.total,
          percent: marked.result.percent,
          passed: marked.result.passed,
          takenAt: new Date().toISOString(),
        },
      ]);
      setPhase('result');
    });
  }

  function retry() {
    setAnswers({});
    setIndex(0);
    setResult(null);
    setSlide(0);
    setSeenLast(quiz.slides.length <= 1);
    setPhase('slides');
    // The questions came with the page; fetch them again so a new attempt
    // is never sat against a set replaced since — and, where the quiz
    // deals from a pool (ADR-0111), so the next hand is dealt.
    router.refresh();
  }

  const history =
    attempts.length > 0 ? (
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
              Attempt {a.attemptNo} of {quiz.maxAttempts}
            </span>
          </MobileRow>
        ))}
      </MobileList>
    ) : null;

  const roles = quiz.roles.join(' and ');

  // ── Passed, for good ────────────────────────────────────────────────
  if (quiz.passed && phase !== 'slides') {
    return (
      <>
        <div className="static-screen quiz-result">
          <Pill tone="green" large>
            Passed
          </Pill>
          <h2>{firstName ? `You’re all set, ${firstName}` : 'You’re all set'}</h2>
          <p>
            You’ve passed {quiz.title} — you’re cleared for {roles} shifts with {quiz.clientName}{' '}
            from now on. Nothing more to do.
          </p>
        </div>
        {history}
        <Button block onClick={() => setPhase('slides')}>
          Read the menu again
        </Button>
        <Link className="btn primary block lg" href="/shifts">
          Back to Shifts
        </Link>
      </>
    );
  }

  // ── No attempts left ────────────────────────────────────────────────
  if (quiz.failed && phase !== 'slides' && phase !== 'result') {
    return (
      <>
        <div className="static-screen quiz-result">
          <Pill tone="coral" large>
            Not passed
          </Pill>
          <h2>No attempts left</h2>
          <p>
            You’ve used all {quiz.maxAttempts} attempts at {quiz.title}. The office has been told
            and will be in touch about your {quiz.clientName} shifts.
          </p>
        </div>
        {history}
        <Button block onClick={() => setPhase('slides')}>
          Read the menu
        </Button>
        <Link className="btn primary block lg" href="/shifts">
          Back to Shifts
        </Link>
      </>
    );
  }

  // ── The result of a sitting ─────────────────────────────────────────
  if (phase === 'result' && result) {
    const passed = result.outcome === 'passed';
    return (
      <>
        <div className="static-screen quiz-result">
          <Pill tone={passed ? 'green' : 'coral'} large>
            {passed ? 'Passed' : 'Not passed'}
          </Pill>
          <div className={`score-big ${passed ? 'green' : 'coral'}`}>{result.percent}%</div>
          <h2>
            {passed ? `Well done${firstName ? `, ${firstName}` : ''}` : 'Not quite this time'}
          </h2>
          <p>
            {result.correct} of {result.total} correct —{' '}
            {passed ? (
              <>
                the pass mark is {quiz.passMarkPercent}%. You’re cleared for {roles} shifts with{' '}
                {quiz.clientName} from now on.
              </>
            ) : result.outcome === 'retry' ? (
              <>
                you need {quiz.passMarkPercent}%.{' '}
                <b className="amber">
                  You have {result.attemptsLeft}{' '}
                  {result.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.
                </b>{' '}
                Go back over the menu before you try again
                {rotates ? ' — the next questions will be different ones' : ''}.
              </>
            ) : (
              <>
                you need {quiz.passMarkPercent}%, and that was your last attempt. The office has
                been told and will be in touch about your {quiz.clientName} shifts.
              </>
            )}
          </p>
        </div>
        {!passed && result.outcome === 'retry' ? (
          <Alert tone="neutral">
            After {quiz.maxAttempts} unsuccessful attempts the office decides what happens next.
          </Alert>
        ) : null}
        {history}
        {passed || result.outcome === 'failed' ? (
          <Link className="btn primary block lg" href="/shifts">
            Back to Shifts
          </Link>
        ) : (
          <Button tone="primary" size="lg" block onClick={retry}>
            Try again — attempt {result.attemptNo + 1} of {quiz.maxAttempts}
          </Button>
        )}
      </>
    );
  }

  // ── The front page ──────────────────────────────────────────────────
  if (phase === 'front') {
    return (
      <>
        <div className="mcard">
          <div className="card-head">
            <Pill tone="amber">Before your first shift</Pill>
            <Pill className="ml-auto">
              Attempt {attemptNo} of {quiz.maxAttempts}
            </Pill>
          </div>
          <div className="t">{quiz.title}</div>
          <p className="m">
            {quiz.intro ??
              `${quiz.clientName} asks everyone on ${roles} shifts to pass this quiz first.`}
          </p>
          <div className="quiz-steps xs muted">
            <span>{quiz.slides.length} slides</span>
            <span>·</span>
            <span>{total} questions</span>
            <span>·</span>
            <span>
              pass mark {quiz.passMarkPercent}% ({passMark} of {total})
            </span>
          </div>
          {rotates ? (
            <p className="xs muted">
              The {total} questions are dealt from a set of {quiz.questionPool}, so no two sittings
              ask quite the same ones.
            </p>
          ) : null}
        </div>
        {history}
        <p className="xs muted">
          Read every slide — the questions are on what they say. Your answers are checked at the
          end, not one by one. One pass covers {roles} shifts with {quiz.clientName} for good.
        </p>
        <Button tone="primary" size="lg" block onClick={() => setPhase('slides')}>
          Start — read the menu
        </Button>
      </>
    );
  }

  // ── The slides ──────────────────────────────────────────────────────
  if (phase === 'slides') {
    const current = quiz.slides[slide];
    const last = slide === quiz.slides.length - 1;
    const readOnly = quiz.passed || quiz.failed;
    return (
      <>
        {current ? (
          <SlideView slide={current} />
        ) : (
          <Alert tone="coral">This quiz has no slides yet. Please contact the office.</Alert>
        )}
        <div className="row">
          <span className="mono sm">
            Slide {slide + 1} of {quiz.slides.length}
          </span>
          <span className="ml-auto xs muted">{last ? 'Last slide' : ''}</span>
        </div>
        <div className="dots" aria-hidden="true">
          {quiz.slides.map((s, i) => (
            <i
              key={`${s.heading}-${i}`}
              className={i === slide ? 'on' : i < slide ? 'done' : undefined}
            />
          ))}
        </div>
        <div className="row">
          <Button block className="grow" disabled={slide === 0} onClick={() => goSlide(slide - 1)}>
            ‹ Previous
          </Button>
          <Button
            tone="primary"
            block
            className="grow"
            disabled={last}
            onClick={() => goSlide(slide + 1)}
          >
            Next ›
          </Button>
        </div>
        {readOnly ? (
          <Link className="btn block" href="/shifts">
            Back to Shifts
          </Link>
        ) : (
          <>
            <div className="xs muted center-text">
              {seenLast
                ? 'You can come back to any slide before you start.'
                : `Unlocks on the last slide (${quiz.slides.length} of ${quiz.slides.length})`}
            </div>
            <Button
              tone="primary"
              size="lg"
              block
              disabled={!seenLast}
              onClick={() => setPhase('questions')}
            >
              Continue to the questions
            </Button>
          </>
        )}
      </>
    );
  }

  // ── The questions ───────────────────────────────────────────────────
  const q = quiz.questions[index];
  if (!q) {
    return <Alert tone="coral">The quiz isn’t available yet. Please contact the office.</Alert>;
  }
  const answered = answers[q.id] !== undefined;
  const last = index === total - 1;

  return (
    <>
      <div className="row">
        <h2 className="grow">
          Question {index + 1} of {total}
        </h2>
        <Pill className="ml-auto">
          Attempt {attemptNo} of {quiz.maxAttempts}
        </Pill>
      </div>
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
        One answer per question. Pass mark {quiz.passMarkPercent}% ({passMark} of {total}). Your
        answers are checked at the end, not one by one.
      </div>
      <div className="row">
        {index > 0 ? (
          <button type="button" className="linkbtn" onClick={() => setIndex(index - 1)}>
            ‹ Previous question
          </button>
        ) : (
          <button type="button" className="linkbtn" onClick={() => setPhase('slides')}>
            ‹ Back to the menu
          </button>
        )}
      </div>
      {error ? <Alert tone="coral">{error}</Alert> : null}
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
    </>
  );
}

/** One slide: a heading, a note, and the price list as a small table. */
export function SlideView({ slide }: { slide: QuizSlide }) {
  return (
    <div className="slide menu-slide" aria-live="polite">
      <div className="st">{slide.heading}</div>
      {slide.note ? <p>{slide.note}</p> : null}
      {slide.rows.length > 0 ? (
        <table className="menu-table">
          {slide.columns.length > 0 ? (
            <thead>
              <tr>
                <th scope="col" aria-label="Item" />
                {slide.columns.map((column) => (
                  <th scope="col" className="price" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {slide.rows.map((row, i) => (
              <tr key={`${row[0]}-${i}`}>
                <td>{row[0]}</td>
                {slide.columns.map((column, c) => (
                  <td className="price" key={column}>
                    {row[c + 1] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
