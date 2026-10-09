'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Chip, Modal, Panel, Pill, TableScroll } from '@thc/ui';
import { employeeId, formatUkDate } from '../../staff/staff';
import { resetQuizAttempts } from './actions';
import type { QuizResultRow, ShiftRequirementRow } from './types';

/**
 * Shift requirements (ADR-0110) — what this client asks of a worker beyond
 * turning up, per role: a quiz to pass before their first shift, and a
 * message to confirm on the morning of every shift. Under it, everyone
 * who has sat the quiz and where they stand, with Reset for a worker who
 * has used every attempt.
 *
 * Read-only for the roles and the messages: the quiz, its slides and its
 * questions are data, installed as the H&S questions are (migration
 * 20261008180000). Not in the wireframe; the ADR is the deviation record.
 */
export function ShiftRequirements({
  clientId,
  rows,
  results,
  canWrite,
}: {
  clientId: string;
  rows: ShiftRequirementRow[];
  results: QuizResultRow[];
  /** ADR-0060: office_can('write') — a viewer sees the standing, not the Reset. */
  canWrite: boolean;
}) {
  const [resetting, setResetting] = useState<QuizResultRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const quizzes = new Map<string, string>();
  for (const row of rows)
    if (row.quiz_id && row.quiz_title) quizzes.set(row.quiz_id, row.quiz_title);

  function reset(row: QuizResultRow) {
    setProblem(null);
    start(async () => {
      const result = await resetQuizAttempts(clientId, row.quiz_id, row.staff_id);
      if (result.ok) setResetting(null);
      else setProblem(result.message);
    });
  }

  return (
    <Panel
      title="Shift requirements"
      actions={
        <span className="muted sm">
          a quiz before the first shift on a role, a message to confirm on the day of every shift
        </span>
      }
      flush
    >
      {problem ? (
        <div className="panel-b">
          <Alert tone="coral">{problem}</Alert>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="empty">
          <h3>This client asks nothing extra</h3>
          <p>
            No quiz and no kit message on any role. Set up as data by the office (migration
            20261008180000); the Leonardo Hotel bar menu quiz is the first.
          </p>
        </div>
      ) : (
        <TableScroll>
          <table className="tbl" data-testid="shift-requirements">
            <thead>
              <tr>
                <th>Role</th>
                <th>Quiz before the first shift</th>
                <th>Message on the day</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <b>{row.role_name}</b>
                  </td>
                  <td>
                    {row.quiz_title ? (
                      <>
                        {row.quiz_title}{' '}
                        <span className="muted xs">
                          · {row.quiz_attempts_max ?? 3} attempts · one pass covers every role that
                          names it
                        </span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {row.kit_message ? (
                      <>
                        “{row.kit_message}”{' '}
                        <span className="muted xs">
                          · pushed at 07:00 UK on the day, or three hours before an early start,
                          until the worker confirms it
                        </span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {quizzes.size > 0 ? (
        <div className="panel-b stack">
          <h4>Quiz results</h4>
          {results.length === 0 ? (
            <p className="muted sm">
              Nobody has sat {quizzes.size === 1 ? 'the quiz' : 'a quiz'} yet. A worker is asked the
              moment they are first booked on a role that names it.
            </p>
          ) : (
            <TableScroll>
              <table className="tbl" data-testid="quiz-results">
                <thead>
                  <tr>
                    <th>Worker</th>
                    {quizzes.size > 1 ? <th>Quiz</th> : null}
                    <th>Standing</th>
                    <th>Attempts</th>
                    <th>Last sat</th>
                    {canWrite ? <th aria-label="Actions" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr key={`${row.quiz_id}-${row.staff_id}`}>
                      <td>
                        <b>{row.display_name}</b>{' '}
                        <span className="mono muted xs">{employeeId(row.employee_id)}</span>
                      </td>
                      {quizzes.size > 1 ? <td>{row.quiz_title}</td> : null}
                      <td>
                        {row.passed ? (
                          <Pill tone="green">
                            Passed{row.passed_at ? ` · ${formatUkDate(row.passed_at)}` : ''}
                          </Pill>
                        ) : row.failed ? (
                          <Pill tone="coral">Not passed — no attempts left</Pill>
                        ) : (
                          <Pill tone="amber">Not passed yet</Pill>
                        )}
                      </td>
                      <td className="mono">
                        {row.attempts_used} of {row.attempts_max}
                        {row.best_correct !== null && row.total !== null ? (
                          <span className="muted xs">
                            {' '}
                            · best {row.best_correct}/{row.total}
                          </span>
                        ) : null}
                      </td>
                      <td className="mono">
                        {row.last_attempt_at ? formatUkDate(row.last_attempt_at) : '—'}
                      </td>
                      {canWrite ? (
                        <td className="right-align">
                          {row.failed ? (
                            <Button size="sm" onClick={() => setResetting(row)}>
                              Reset attempts
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          <p className="muted xs">
            A worker who runs out of attempts stays booked: the office is emailed and decides.
            <Chip>CR3</Chip>
          </p>
        </div>
      ) : null}

      <Modal
        open={resetting !== null}
        title="Reset quiz attempts?"
        onClose={() => setResetting(null)}
        footer={
          <>
            <Button onClick={() => setResetting(null)}>Keep as is</Button>
            <Button
              tone="primary"
              solid
              disabled={pending}
              onClick={() => resetting && reset(resetting)}
            >
              {pending ? 'Resetting…' : 'Reset attempts'}
            </Button>
          </>
        }
      >
        {resetting ? (
          <p className="muted">
            {resetting.display_name} gets all {resetting.attempts_max} attempts at{' '}
            {resetting.quiz_title} back. Their earlier attempts stay on record. They are asked again
            on their Shifts tab from their next shift on a role that names it.
          </p>
        ) : null}
      </Modal>
    </Panel>
  );
}
