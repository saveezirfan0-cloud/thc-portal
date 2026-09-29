import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canMessageLineUp,
  messageLength,
  messagePeople,
  messageRefusal,
  messageSentSummary,
  parseMessageTarget,
  pushDate,
} from '../board-model';

/**
 * Message staff (ADR-0069). The action names the event, one section at
 * most and the audience (booked, invited, or both) — never a list of workers; the
 * database picks the recipients. The manager is told how many got it and,
 * by name, who has notifications off.
 */
const state = vi.hoisted(() => ({
  role: 'admin' as string,
  rpc: vi.fn(async (_fn: string, _args: unknown) => ({
    data: null as unknown,
    error: null as null | { message: string },
  })),
  revalidated: [] as string[],
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));
vi.mock('../../db', () => ({
  eventsDb: () => ({
    rpc: state.rpc,
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`the action must not touch ${table} directly`);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { role: state.role } }) }),
        }),
      };
    },
  }),
  supabaseConfigured: () => true,
}));

const { messageLineUp } = await import('../actions');

beforeEach(() => {
  state.role = 'admin';
  state.rpc.mockReset();
  state.revalidated.length = 0;
});

describe('messageLineUp', () => {
  it('sends through send_event_message with the section and the audience, nothing else', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: true, sent: 12, withoutPush: [], messageId: 'm-1' },
      error: null,
    });
    const result = await messageLineUp('evt-1', {
      sectionId: 'sec-2',
      audience: 'invited',
      message: 'Staff entrance is on King St',
    });
    expect(state.rpc).toHaveBeenCalledWith('send_event_message', {
      p_event: 'evt-1',
      p_section: 'sec-2',
      p_audience: 'invited',
      p_message: 'Staff entrance is on King St',
    });
    expect(result).toEqual({ ok: true, summary: 'Sent to 12 people.', everyoneReached: true });
    expect(state.revalidated).toEqual(['/events/evt-1']);
  });

  it('names the people with notifications off, so the manager can phone them', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: true, sent: 3, withoutPush: ['Amy Lee', 'Sam Roe'] },
      error: null,
    });
    const result = await messageLineUp('evt-1', {
      sectionId: null,
      audience: 'booked',
      message: 'x',
    });
    expect(result).toEqual({
      ok: true,
      summary:
        'Sent to 3 people. These people have notifications off and will not get it — phone them: Amy Lee, Sam Roe.',
      everyoneReached: false,
    });
  });

  it('refuses a blank message before calling anything', async () => {
    expect(
      await messageLineUp('evt-1', { sectionId: null, audience: 'booked', message: '   ' }),
    ).toEqual({ error: 'Write the message first.' });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('turns a refusal into words', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: false, reason: 'nobody_to_message' },
      error: null,
    });
    const result = await messageLineUp('evt-1', {
      sectionId: null,
      audience: 'booked',
      message: 'x',
    });
    expect(result).toEqual({ error: messageRefusal('nobody_to_message') });
    expect((result as { error: string }).error).toMatch(/Choose "Invited only"/);
    expect(state.revalidated).toEqual([]);
  });

  it('does not suggest the invitees when they were already asked for', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: false, reason: 'nobody_to_message' },
      error: null,
    });
    const result = await messageLineUp('evt-1', {
      sectionId: null,
      audience: 'booked_and_invited',
      message: 'x',
    });
    expect(result).toEqual({ error: 'Nobody is booked on that yet — there is nobody to message.' });
  });

  it('messages the invitees on their own, and says so when there are none', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: false, reason: 'nobody_to_message' },
      error: null,
    });
    const result = await messageLineUp('evt-1', {
      sectionId: 'sec-2',
      audience: 'invited',
      message: 'You still have an invite for tonight — please reply',
    });
    expect(state.rpc).toHaveBeenCalledWith(
      'send_event_message',
      expect.objectContaining({ p_section: 'sec-2', p_audience: 'invited' }),
    );
    expect(result).toEqual({
      error: 'Nobody has an open invitation for that — there is nobody to message.',
    });
  });

  it('refuses a signed-in account that is not the office', async () => {
    state.role = 'staff';
    const result = await messageLineUp('evt-1', {
      sectionId: null,
      audience: 'booked',
      message: 'x',
    });
    expect(result).toEqual({ error: 'Only the office can do this.' });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('tells a view-only login it cannot send', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'read_only' } });
    expect(
      await messageLineUp('evt-1', { sectionId: null, audience: 'booked', message: 'x' }),
    ).toEqual({ error: 'A view-only login cannot send messages.' });
  });
});

describe('the words around it', () => {
  it('has copy for every refusal the database gives', () => {
    for (const reason of [
      'audience_unknown',
      'message_required',
      'message_too_long',
      'event_cancelled',
      'event_over',
      'section_not_on_event',
      'nobody_to_message',
    ]) {
      expect(messageRefusal(reason), reason).not.toMatch(/not sent \(/);
    }
    expect(messageRefusal('mystery')).toBe('The message was not sent (mystery).');
  });

  it('says "person" for one, and names a single phone call', () => {
    expect(messageSentSummary(1, [])).toBe('Sent to 1 person.');
    expect(messageSentSummary(1, ['Amy Lee'])).toBe(
      'Sent to 1 person. This person has notifications off and will not get it — phone them: Amy Lee.',
    );
  });

  it('counts characters as the database does, so an emoji is one', () => {
    expect(messageLength('  🍾 Bring shoes  ')).toBe(13);
  });

  it("shows the date the push title will carry — to_char(..., 'Dy DD Mon')", () => {
    expect(pushDate('2026-10-03')).toBe('Sat 03 Oct');
    expect(pushDate('2026-09-01')).toBe('Tue 01 Sep');
  });

  it('is offered while the event is upcoming or under way, not once it is over or cancelled', () => {
    expect(canMessageLineUp('upcoming')).toBe(true);
    expect(canMessageLineUp('ongoing')).toBe(true);
    expect(canMessageLineUp('completed')).toBe(false);
    expect(canMessageLineUp('cancelled')).toBe(false);
  });
});

describe('one person (ADR-0069, amended 29.09)', () => {
  it('sends the booking as p_booking and nothing about a section', async () => {
    state.rpc.mockResolvedValueOnce({ data: { ok: true, sent: 1, withoutPush: [] }, error: null });
    const result = await messageLineUp('evt-1', {
      sectionId: null,
      bookingId: 'bk-7',
      audience: 'booked',
      message: 'Please bring your black apron',
    });
    expect(state.rpc).toHaveBeenCalledWith('send_event_message', {
      p_event: 'evt-1',
      p_section: null,
      p_audience: 'booked',
      p_message: 'Please bring your black apron',
      p_booking: 'bk-7',
    });
    expect(result).toEqual({ ok: true, summary: 'Sent to 1 person.', everyoneReached: true });
  });

  it('leaves p_booking out for the whole event or a role, so a database without the one-person migration still answers', async () => {
    state.rpc.mockResolvedValueOnce({ data: { ok: true, sent: 2, withoutPush: [] }, error: null });
    await messageLineUp('evt-1', { sectionId: 'sec-1', audience: 'booked', message: 'x' });
    expect(state.rpc.mock.calls[0]![1]).toMatchObject({ p_section: 'sec-1' });
    expect(state.rpc.mock.calls[0]![1]).not.toHaveProperty('p_booking');
  });

  it('says plainly when the database has not got one-person messaging yet', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Could not find the function public.send_event_message(...)',
        code: 'PGRST202',
      } as never,
    });
    const result = await messageLineUp('evt-1', {
      sectionId: null,
      bookingId: 'bk-7',
      audience: 'booked',
      message: 'x',
    });
    expect((result as { error: string }).error).toMatch(/not switched on yet/);
  });

  it('says so when the person is no longer booked', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: false, reason: 'person_not_booked' },
      error: null,
    });
    const result = await messageLineUp('evt-1', {
      sectionId: null,
      bookingId: 'bk-7',
      audience: 'booked',
      message: 'x',
    });
    expect((result as { error: string }).error).toMatch(/no longer booked/);
  });

  it('reads the To value: everyone, a role, or a person', () => {
    expect(parseMessageTarget('')).toEqual({ kind: 'event' });
    expect(parseMessageTarget('section:sec-1')).toEqual({ kind: 'section', sectionId: 'sec-1' });
    expect(parseMessageTarget('person:bk-7')).toEqual({ kind: 'person', bookingId: 'bk-7' });
  });

  it("lists a role's confirmed staff, then its invitees, by the name the board shows", () => {
    expect(
      messagePeople({
        confirmed: [{ bookingId: 'b1', name: 'Grace L.' }],
        invited: [{ bookingId: 'b2', name: 'Sam R.' }],
      }),
    ).toEqual([
      { bookingId: 'b1', name: 'Grace L.', invited: false },
      { bookingId: 'b2', name: 'Sam R.', invited: true },
    ]);
  });

  it('has words for the two new refusals', () => {
    for (const reason of ['booking_not_on_event', 'person_not_booked']) {
      expect(messageRefusal(reason), reason).not.toMatch(/not sent \(/);
    }
  });
});
