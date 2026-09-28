import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canMessageLineUp, messageRefusal, messageSentSummary } from '../board-model';

/**
 * Message staff (ADR-0069). The action names the event, one section at
 * most and whether invitees are included — never a list of workers; the
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
  it('sends through send_event_message with the section and the invitee switch, nothing else', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: true, sent: 12, withoutPush: [], messageId: 'm-1' },
      error: null,
    });
    const result = await messageLineUp('evt-1', {
      sectionId: 'sec-2',
      includeInvited: true,
      message: 'Staff entrance is on King St',
    });
    expect(state.rpc).toHaveBeenCalledWith('send_event_message', {
      p_event: 'evt-1',
      p_section: 'sec-2',
      p_include_invited: true,
      p_message: 'Staff entrance is on King St',
    });
    expect(result).toEqual({ ok: true, summary: 'Sent to 12 people.' });
    expect(state.revalidated).toEqual(['/events/evt-1']);
  });

  it('names the people with notifications off, so the manager can phone them', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: true, sent: 3, withoutPush: ['Amy Lee', 'Sam Roe'] },
      error: null,
    });
    const result = await messageLineUp('evt-1', {
      sectionId: null,
      includeInvited: false,
      message: 'x',
    });
    expect(result).toEqual({
      ok: true,
      summary:
        'Sent to 3 people. These people have notifications off and will not get it — phone them: Amy Lee, Sam Roe.',
    });
  });

  it('refuses a blank message before calling anything', async () => {
    expect(
      await messageLineUp('evt-1', { sectionId: null, includeInvited: false, message: '   ' }),
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
      includeInvited: false,
      message: 'x',
    });
    expect(result).toEqual({ error: messageRefusal('nobody_to_message') });
    expect(state.revalidated).toEqual([]);
  });

  it('refuses a signed-in account that is not the office', async () => {
    state.role = 'staff';
    const result = await messageLineUp('evt-1', {
      sectionId: null,
      includeInvited: false,
      message: 'x',
    });
    expect(result).toEqual({ error: 'Only the office can do this.' });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('tells a view-only login it cannot send', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'read_only' } });
    expect(
      await messageLineUp('evt-1', { sectionId: null, includeInvited: false, message: 'x' }),
    ).toEqual({ error: 'A view-only login cannot send messages.' });
  });
});

describe('the words around it', () => {
  it('has copy for every refusal the database gives', () => {
    for (const reason of [
      'message_required',
      'message_too_long',
      'event_cancelled',
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

  it('is offered while the event is upcoming or under way, not once it is over or cancelled', () => {
    expect(canMessageLineUp('upcoming')).toBe(true);
    expect(canMessageLineUp('ongoing')).toBe(true);
    expect(canMessageLineUp('completed')).toBe(false);
    expect(canMessageLineUp('cancelled')).toBe(false);
  });
});
