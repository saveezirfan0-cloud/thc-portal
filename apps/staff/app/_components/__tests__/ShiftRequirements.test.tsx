import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ShiftRequirementRow } from '../../data';

// Outside Next there is no server; the action is not under test.
vi.mock('../../actions', () => ({ acknowledgeKit: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('../useViewerZone', () => ({ useViewerZone: () => 'Europe/London' }));

const { AcceptNeedsQuiz, KitMessage, QuizBeforeAcceptNote, QuizPrompt, ShiftRequirements } =
  await import('../ShiftRequirements');

const requirement = (over: Partial<ShiftRequirementRow> = {}): ShiftRequirementRow => ({
  bookingId: 'b1',
  clientId: 'c1',
  clientName: 'Leonardo Hotel St Pauls',
  roleName: 'Bar Staff',
  quizId: 'q1',
  quizTitle: 'Bar menu — Leonardo Royal Hotel London',
  quizPassed: false,
  quizAttemptsUsed: 0,
  quizAttemptsMax: 3,
  kitMessage: "Don't forget to bring your bottle opener, notepad and pen to your shift",
  kitDueAt: new Date('2026-10-20T06:00:00Z'),
  kitAcknowledgedAt: null,
  ...over,
});

/** ADR-0110 · the quiz card and the kit message on the worker's shift. */
describe('QuizPrompt', () => {
  it('asks for the quiz with a link to it and the attempts', () => {
    const markup = renderToStaticMarkup(<QuizPrompt requirement={requirement()} />);
    expect(markup).toContain('Quiz needed');
    expect(markup).toContain('href="/quiz/q1"');
    expect(markup).toContain('Take the quiz');
    expect(markup).toContain('you have 3 attempts.');
  });

  it('offers another go with the attempts left', () => {
    const markup = renderToStaticMarkup(
      <QuizPrompt requirement={requirement({ quizAttemptsUsed: 2 })} />,
    );
    expect(markup).toContain('Try the quiz again');
    expect(markup).toContain('you have 1 attempt left.');
  });

  it('shows no button once every attempt is used — the office has been told', () => {
    const markup = renderToStaticMarkup(
      <QuizPrompt requirement={requirement({ quizAttemptsUsed: 3 })} />,
    );
    expect(markup).toContain('Quiz not passed');
    expect(markup).toContain('The office has been told');
    expect(markup).not.toContain('href="/quiz/q1"');
  });
});

describe('ADR-0150 · the quiz before Accept', () => {
  it('stands a Take the quiz link in for the Accept button, and counts the attempt', () => {
    const fresh = renderToStaticMarkup(<AcceptNeedsQuiz requirement={requirement()} size="lg" />);
    expect(fresh).toContain('href="/quiz/q1"');
    expect(fresh).toContain('Take the quiz to accept');
    expect(fresh).toContain('class="btn primary block lg"');
    const again = renderToStaticMarkup(
      <AcceptNeedsQuiz requirement={requirement({ quizAttemptsUsed: 1 })} />,
    );
    expect(again).toContain('Try the quiz again');
  });

  it('with every attempt used, a disabled button and no link', () => {
    const markup = renderToStaticMarkup(
      <AcceptNeedsQuiz requirement={requirement({ quizAttemptsUsed: 3 })} />,
    );
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Quiz not passed');
    expect(markup).not.toContain('href=');
  });

  it('the note names the client and the role, and says the invitation stays open', () => {
    const note = renderToStaticMarkup(<QuizBeforeAcceptNote requirement={requirement()} />);
    expect(note).toContain('Leonardo Hotel St Pauls');
    expect(note).toContain('Bar Staff');
    expect(note).toContain('this invitation stays open');
    const failed = renderToStaticMarkup(
      <QuizBeforeAcceptNote requirement={requirement({ quizAttemptsUsed: 3 })} />,
    );
    expect(failed).toContain('used all 3 attempts');
    expect(failed).toContain('The office has been told');
  });
});

describe('KitMessage', () => {
  const before = new Date('2026-10-19T20:00:00Z');
  const onTheDay = new Date('2026-10-20T07:30:00Z');

  it('is a note before the reminder is due, with no button', () => {
    const markup = renderToStaticMarkup(<KitMessage requirement={requirement()} now={before} />);
    expect(markup).toContain('What to bring:');
    expect(markup).toContain('bottle opener, notepad and pen');
    expect(markup).not.toContain('I’ve read this');
  });

  it('asks for confirmation once due', () => {
    const markup = renderToStaticMarkup(<KitMessage requirement={requirement()} now={onTheDay} />);
    expect(markup).toContain('From Leonardo Hotel St Pauls:');
    expect(markup).toContain('I’ve read this and I’ll bring them');
  });

  it('reads confirmed once acknowledged, whatever the time', () => {
    const markup = renderToStaticMarkup(
      <KitMessage
        requirement={requirement({ kitAcknowledgedAt: new Date('2026-10-20T07:10:00Z') })}
        now={onTheDay}
      />,
    );
    expect(markup).toContain('What to bring — confirmed.');
    expect(markup).not.toContain('I’ve read this');
  });
});

describe('ShiftRequirements', () => {
  it('draws both blocks on the shift screen, and only the message once the quiz is passed', () => {
    const both = renderToStaticMarkup(
      <ShiftRequirements requirement={requirement()} now={new Date('2026-10-19T20:00:00Z')} />,
    );
    expect(both).toContain('Quiz needed');
    expect(both).toContain('What to bring:');
    const passed = renderToStaticMarkup(
      <ShiftRequirements
        requirement={requirement({ quizPassed: true })}
        now={new Date('2026-10-19T20:00:00Z')}
      />,
    );
    expect(passed).not.toContain('Quiz needed');
    expect(passed).toContain('What to bring:');
  });

  it('leaves the quiz to the list when told to', () => {
    const markup = renderToStaticMarkup(
      <ShiftRequirements requirement={requirement()} showQuiz={false} />,
    );
    expect(markup).not.toContain('Quiz needed');
  });
});
