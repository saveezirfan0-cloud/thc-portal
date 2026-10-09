import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { QuizResultRow, ShiftRequirementRow } from '../types';

// Outside Next there is no server; the action is not under test.
vi.mock('../actions', () => ({ resetQuizAttempts: vi.fn() }));

const { ShiftRequirements } = await import('../ShiftRequirements');

const KIT =
  "Don't forget to bring your bottle opener, notepad and pen to your shift - without this you will not be able to work this shift";

const rows: ShiftRequirementRow[] = [
  {
    id: 'r1',
    client_id: 'c1',
    role_id: 'bar',
    role_name: 'Bar Staff',
    quiz_id: 'q1',
    quiz_title: 'Bar menu — Leonardo Royal Hotel London',
    quiz_attempts_max: 3,
    kit_message: KIT,
  },
  {
    id: 'r2',
    client_id: 'c1',
    role_id: 'wine',
    role_name: 'Wine Waiting Service',
    quiz_id: 'q1',
    quiz_title: 'Bar menu — Leonardo Royal Hotel London',
    quiz_attempts_max: 3,
    kit_message: KIT,
  },
];

const result = (over: Partial<QuizResultRow> = {}): QuizResultRow => ({
  quiz_id: 'q1',
  client_id: 'c1',
  quiz_title: 'Bar menu — Leonardo Royal Hotel London',
  staff_id: 's1',
  display_name: 'Amy Adeyemi',
  employee_id: 216,
  attempts_used: 1,
  attempts_max: 3,
  passed: true,
  passed_at: '2026-10-08T10:00:00Z',
  last_attempt_at: '2026-10-08T10:00:00Z',
  failed: false,
  best_correct: 9,
  total: 10,
  ...over,
});

/** ADR-0110: the client card's Shift requirements block. */
describe('Shift requirements on the client card (ADR-0110)', () => {
  it('lists each role with its quiz and its message', () => {
    const markup = renderToStaticMarkup(
      <ShiftRequirements clientId="c1" rows={rows} results={[]} canWrite />,
    );
    expect(markup).toContain('Bar Staff');
    expect(markup).toContain('Wine Waiting Service');
    expect(markup).toContain('Bar menu — Leonardo Royal Hotel London');
    expect(markup).toContain('bottle opener, notepad and pen');
    expect(markup).toContain('Nobody has sat the quiz yet');
  });

  it('says so when the client asks nothing', () => {
    const markup = renderToStaticMarkup(
      <ShiftRequirements clientId="c1" rows={[]} results={[]} canWrite />,
    );
    expect(markup).toContain('This client asks nothing extra');
    expect(markup).not.toContain('Quiz results');
  });

  it('shows who passed, who is still to pass, and who ran out — with Reset only for the last', () => {
    const markup = renderToStaticMarkup(
      <ShiftRequirements
        clientId="c1"
        rows={rows}
        results={[
          result(),
          result({
            staff_id: 's2',
            display_name: 'Ben Okafor',
            employee_id: 3,
            passed: false,
            passed_at: null,
            attempts_used: 2,
            best_correct: 7,
          }),
          result({
            staff_id: 's3',
            display_name: 'Cara Lund',
            employee_id: 17,
            passed: false,
            passed_at: null,
            attempts_used: 3,
            failed: true,
            best_correct: 6,
          }),
        ]}
        canWrite
      />,
    );
    expect(markup).toContain('Passed · 08.10.2026');
    expect(markup).toContain('Not passed yet');
    expect(markup).toContain('Not passed — no attempts left');
    expect(markup).toContain('THC-00216');
    expect(markup).toContain('best 9/10');
    expect((markup.match(/Reset attempts/g) ?? []).length).toBe(1);
  });

  it('is read-only for a viewer (ADR-0060)', () => {
    const markup = renderToStaticMarkup(
      <ShiftRequirements
        clientId="c1"
        rows={rows}
        results={[result({ passed: false, passed_at: null, attempts_used: 3, failed: true })]}
        canWrite={false}
      />,
    );
    expect(markup).toContain('Not passed — no attempts left');
    expect(markup).not.toContain('Reset attempts');
  });
});
