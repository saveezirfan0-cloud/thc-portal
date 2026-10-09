import Link from 'next/link';
import { Alert, Pill } from '@thc/ui';
import type { ShiftRequirementRow } from '../data';
import { acknowledgeKit } from '../actions';
import { ActionButton } from './ActionButton';
import { UkTime } from './UkTime';

/**
 * What a client asks of the worker beyond turning up (ADR-0110), drawn on
 * the /shifts card and at the top of the shift screen.
 *
 * Two blocks, each only when it applies:
 *
 *   · the quiz — until it is passed. A worker who has used every attempt
 *     is told the office has been asked, not shown a button that can only
 *     fail;
 *   · the kit message — the client's own words, with "I've read this"
 *     once the morning-of reminder is due and until it is pressed. Before
 *     it is due the words are shown as information, so nobody is surprised
 *     by them on the day.
 *
 * Neither gates check-in: the scope's day-of-shift rules (§5.1) are not
 * changed by a client's ask. What the client said follows — "without this
 * you will not be able to work this shift" — is the client's, and the
 * message carries it.
 */
export function ShiftRequirements({
  requirement,
  now = new Date(),
  showQuiz = true,
}: {
  requirement: ShiftRequirementRow;
  now?: Date;
  /** The /shifts list draws the quiz once above the cards, not on each. */
  showQuiz?: boolean;
}) {
  return (
    <>
      {showQuiz && requirement.quizId && !requirement.quizPassed ? (
        <QuizPrompt requirement={requirement} />
      ) : null}
      {requirement.kitMessage ? <KitMessage requirement={requirement} now={now} /> : null}
    </>
  );
}

/** The quiz card: once per quiz on /shifts, and on the shift screen. */
export function QuizPrompt({ requirement }: { requirement: ShiftRequirementRow }) {
  const left = Math.max(requirement.quizAttemptsMax - requirement.quizAttemptsUsed, 0);
  const failed = left === 0;
  return (
    <div className="mcard needs quiz-prompt" data-testid="quiz-prompt">
      <div className="card-head">
        <Pill tone={failed ? 'coral' : 'amber'}>{failed ? 'Quiz not passed' : 'Quiz needed'}</Pill>
      </div>
      <div className="t">{requirement.quizTitle}</div>
      <p className="m">
        {failed ? (
          <>
            You’ve used all {requirement.quizAttemptsMax} attempts. The office has been told and
            will be in touch about your {requirement.clientName} shifts.
          </>
        ) : (
          <>
            {requirement.clientName} asks everyone on {requirement.roleName} shifts to pass a short
            quiz before their first one. Read the menu, then answer ten questions —{' '}
            {requirement.quizAttemptsUsed === 0
              ? `you have ${left} attempts.`
              : `you have ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`}
          </>
        )}
      </p>
      {failed ? null : (
        <Link className="btn primary block lg" href={`/quiz/${requirement.quizId}`}>
          {requirement.quizAttemptsUsed === 0 ? 'Take the quiz' : 'Try the quiz again'}
        </Link>
      )}
    </div>
  );
}

/** The kit message, and "I've read this" once it is due. */
export function KitMessage({
  requirement,
  now = new Date(),
}: {
  requirement: ShiftRequirementRow;
  now?: Date;
}) {
  const due = requirement.kitDueAt !== null && now >= requirement.kitDueAt;
  const acknowledged = requirement.kitAcknowledgedAt !== null;

  if (acknowledged) {
    return (
      <Alert tone="green">
        <b>What to bring — confirmed.</b> {requirement.kitMessage}
      </Alert>
    );
  }
  if (!due) {
    return (
      <Alert tone="neutral">
        <b>What to bring:</b> {requirement.kitMessage}
        {requirement.kitDueAt ? (
          <>
            {' '}
            <span className="xs muted">
              You’ll be asked to confirm this on the day, from <UkTime at={requirement.kitDueAt} />.
            </span>
          </>
        ) : null}
      </Alert>
    );
  }
  return (
    <div className="kit-ack" data-testid="kit-ack">
      <Alert tone="amber">
        <b>From {requirement.clientName}:</b> {requirement.kitMessage}
      </Alert>
      <ActionButton
        label="I’ve read this and I’ll bring them"
        tone="primary"
        block
        action={acknowledgeKit.bind(null, requirement.bookingId)}
      />
    </div>
  );
}
