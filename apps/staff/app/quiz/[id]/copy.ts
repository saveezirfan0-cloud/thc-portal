/**
 * The worker's sentence for each reason `submit_client_quiz_attempt()` answers
 * with (ADR-0108). Its own module: a 'use server' file may export only
 * async functions.
 */
/** The sentence for each reason the database answers with. */
export function refusalCopy(reason: string | null): string {
  switch (reason) {
    case 'incomplete':
      return 'Please answer every question before you submit.';
    case 'quiz_changed':
      return 'The quiz was updated while you were answering. Please start again on the new questions.';
    case 'already_passed':
      return 'You’ve already passed this quiz — nothing more to do.';
    case 'no_attempts_left':
      return 'You’ve used all your attempts at this quiz. The office has been told.';
    case 'quiz_not_required':
      return 'This quiz isn’t for any of your booked shifts.';
    default:
      return 'That didn’t go through. Please try again, or contact the office if it keeps happening.';
  }
}
