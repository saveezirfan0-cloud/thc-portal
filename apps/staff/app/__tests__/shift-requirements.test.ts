import { describe, expect, it } from 'vitest';
import { quizzesOutstanding, requirementsByBooking, toShiftRequirements } from '../data';

/**
 * ADR-0108 · what `staff_shift_requirements()` hands the screens, and which
 * quizzes the /shifts tab asks for.
 */
const row = (over: Record<string, unknown> = {}) => ({
  booking_id: 'b1',
  client_id: 'c1',
  client_name: 'Leonardo Hotel St Pauls',
  role_name: 'Bar Staff',
  quiz_id: 'q1',
  quiz_title: 'Bar menu — Leonardo Royal Hotel London',
  quiz_passed: false,
  quiz_attempts_used: 1,
  quiz_attempts_max: 3,
  kit_message: "Don't forget to bring your bottle opener, notepad and pen to your shift",
  kit_due_at: '2026-10-20T06:00:00Z',
  kit_acknowledged_at: null,
  ...over,
});

describe('toShiftRequirements', () => {
  it('maps a row with a quiz and a kit message', () => {
    const [r] = toShiftRequirements([row()]);
    expect(r).toMatchObject({
      bookingId: 'b1',
      clientName: 'Leonardo Hotel St Pauls',
      roleName: 'Bar Staff',
      quizId: 'q1',
      quizPassed: false,
      quizAttemptsUsed: 1,
      quizAttemptsMax: 3,
      kitAcknowledgedAt: null,
    });
    expect(r!.kitDueAt?.toISOString()).toBe('2026-10-20T06:00:00.000Z');
  });

  it('reads a kit-only role as having no quiz, and a quiz-only role as having no message', () => {
    const [kit] = toShiftRequirements([
      row({ quiz_id: null, quiz_title: null, quiz_passed: null, quiz_attempts_used: null }),
    ]);
    expect(kit!.quizId).toBeNull();
    expect(kit!.quizPassed).toBe(false);
    expect(kit!.quizAttemptsUsed).toBe(0);
    const [quiz] = toShiftRequirements([row({ kit_message: null, kit_due_at: null })]);
    expect(quiz!.kitMessage).toBeNull();
    expect(quiz!.kitDueAt).toBeNull();
  });

  it('is empty for nothing', () => {
    expect(toShiftRequirements(null)).toEqual([]);
  });
});

describe('quizzesOutstanding', () => {
  it('asks once per quiz, however many bookings name it', () => {
    const rows = toShiftRequirements([
      row({ booking_id: 'b1' }),
      row({ booking_id: 'b2', role_name: 'Wine Waiting Service' }),
    ]);
    expect(quizzesOutstanding(rows).map((r) => r.bookingId)).toEqual(['b1']);
  });

  it('asks nothing once passed, and nothing of a kit-only role', () => {
    const rows = toShiftRequirements([
      row({ booking_id: 'b1', quiz_passed: true }),
      row({ booking_id: 'b2', quiz_id: null, quiz_title: null }),
    ]);
    expect(quizzesOutstanding(rows)).toEqual([]);
  });

  it('still lists a quiz with no attempts left — the card says the office has been told', () => {
    const rows = toShiftRequirements([row({ quiz_attempts_used: 3 })]);
    expect(quizzesOutstanding(rows)).toHaveLength(1);
  });

  it('indexes by booking', () => {
    const rows = toShiftRequirements([row({ booking_id: 'b1' }), row({ booking_id: 'b2' })]);
    expect([...requirementsByBooking(rows).keys()]).toEqual(['b1', 'b2']);
  });
});
