import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A customer's comment is bounded (§11.5): the textarea stops at
 * FEEDBACK_TEXT_MAX, the server action refuses past it before the RPC, and
 * the database's own refusal — whichever SQLSTATE it arrives as — reads as
 * one friendly sentence. Ids posted to the action are checked too: a server
 * action is a public endpoint.
 */
const EVENT_ID = '3f2b9c1a-6d4e-4f5a-8b7c-1d2e3f4a5b6c';
const BOOKING_ID = 'b1b2b3b4-c5c6-4d7d-8e8e-f9f0a1a2b3b4';

const state = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  error: null as null | { code: string; message: string },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// The modal re-reads the page after an "already left" answer (router.refresh).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      return { data: null, error: state.error };
    },
  }),
}));

const { leaveFeedback } = await import('../events/[id]/actions');
const { FeedbackModal, commentHint } = await import('../events/[id]/FeedbackModal');
const { FEEDBACK_TEXT_MAX, FEEDBACK_TOO_LONG, feedbackErrorMessage, feedbackTextTooLong } =
  await import('../rules');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  state.calls = [];
  state.error = null;
  vi.restoreAllMocks();
});

describe('the limit', () => {
  it('is 2,000 characters, measured after trimming', () => {
    expect(FEEDBACK_TEXT_MAX).toBe(2000);
    expect(feedbackTextTooLong('a'.repeat(2000))).toBe(false);
    expect(feedbackTextTooLong(`  ${'a'.repeat(2000)}  `)).toBe(false);
    expect(feedbackTextTooLong('a'.repeat(2001))).toBe(true);
    expect(FEEDBACK_TOO_LONG).toBe('Keep the comment to 2,000 characters or fewer.');
  });
});

describe('the modal', () => {
  it('stops the textarea at the limit and keeps the wireframe hint', () => {
    const html = renderToStaticMarkup(
      <FeedbackModal
        open
        eventId={EVENT_ID}
        bookingId={BOOKING_ID}
        personName="Priya Shah"
        role="Waiting Staff"
        eventTitle="Gala Dinner"
        eventDate="Fri 19 Sep 2026"
        onClose={() => {}}
      />,
    );
    expect(html).toMatch(/<textarea[^>]*maxLength="2000"/i);
    expect(html).toContain(
      'Optional · free text · seen by The Hospitality Company office, not by the worker.',
    );
    expect(html).not.toContain('of 2,000 characters');
  });

  it('counts only near the limit', () => {
    expect(commentHint(10)).not.toMatch(/characters/);
    expect(commentHint(1850)).toMatch(/1,850 of 2,000 characters\.$/);
    expect(commentHint(2000)).toMatch(/2,000 of 2,000 characters\.$/);
  });
});

describe('the server action', () => {
  it('refuses a comment over the limit before the RPC', async () => {
    const result = await leaveFeedback(EVENT_ID, BOOKING_ID, 5, 'a'.repeat(2001));
    expect(result).toEqual({ ok: false, error: FEEDBACK_TOO_LONG });
    expect(state.calls).toEqual([]);
  });

  it('sends a comment at the limit', async () => {
    const result = await leaveFeedback(EVENT_ID, BOOKING_ID, 5, 'a'.repeat(2000));
    expect(result).toEqual({ ok: true });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]!.fn).toBe('submit_client_feedback');
    expect((state.calls[0]!.args.p_text as string).length).toBe(2000);
  });

  it('refuses ids that are not uuids before the RPC', async () => {
    for (const [e, b] of [
      ['not-a-uuid', BOOKING_ID],
      [EVENT_ID, 'not-a-uuid'],
    ]) {
      const result = await leaveFeedback(e!, b!, 5, '');
      expect(result).toEqual({ ok: false, error: 'That could not be saved.' });
    }
    expect(state.calls).toEqual([]);
  });

  it('turns the database’s refusal into the customer’s sentence and logs the original', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.error = { code: '22023', message: 'Feedback text must be at most 2000 characters' };
    const result = await leaveFeedback(EVENT_ID, BOOKING_ID, 4, 'fine');
    expect(result).toEqual({ ok: false, error: FEEDBACK_TOO_LONG });
    expect(JSON.stringify(log.mock.calls)).toContain('at most 2000 characters');
  });
});

describe('the database’s length refusal, whichever code it uses', () => {
  it.each([
    ['22023', 'Feedback text must be at most 2000 characters'],
    ['22023', 'comment is too long'],
    ['22001', 'value too long for type character varying(2000)'],
    ['23514', 'new row for relation "feedback" violates check constraint "feedback_text_length"'],
  ])('%s · %s', (code, message) => {
    expect(feedbackErrorMessage({ code, message })).toBe(FEEDBACK_TOO_LONG);
  });

  it('still tells a bad rating and a not-started event apart', () => {
    expect(feedbackErrorMessage({ code: '22023', message: 'Rating must be between 1 and 5' })).toBe(
      'Choose a rating between 1 and 5 stars.',
    );
    expect(
      feedbackErrorMessage({ code: '22023', message: 'Feedback opens once the event has started' }),
    ).toBe('Feedback opens once the event has started.');
  });

  it('an unrelated check constraint is not called a length problem', () => {
    expect(
      feedbackErrorMessage({ code: '23514', message: 'violates check constraint "rating_range"' }),
    ).toBe('That could not be saved.');
  });
});
