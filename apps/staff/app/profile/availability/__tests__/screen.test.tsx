import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ukInstant } from '@thc/domain';

/**
 * /profile/availability — the screen and its two actions (ADR-0036).
 *
 *   - the empty state and the list by week, with "UK time" on a window;
 *   - the actions call only the worker's own RPCs, never name a worker,
 *     and turn each refusal into its sentence;
 *   - a refusal the phone can already see never reaches the database.
 */
const rpc = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AvailabilityScreen } = await import('../AvailabilityScreen');
const { addUnavailability, removeUnavailability } = await import('../actions');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => vi.clearAllMocks());

describe('the screen', () => {
  it('shows the empty state and the Add button when nothing is marked', () => {
    const html = renderToStaticMarkup(<AvailabilityScreen entries={[]} />);
    expect(html).toContain('No days marked');
    expect(html).toContain('+ Add days you can’t work');
    expect(html).not.toContain('Week of');
  });

  it('lists entries by UK week, windows labelled UK time', () => {
    const html = renderToStaticMarkup(
      <AvailabilityScreen
        entries={[
          {
            id: 'a',
            startsAt: ukInstant('2026-09-27', '00:00').toISOString(),
            endsAt: ukInstant('2026-09-28', '00:00').toISOString(),
            allDay: true,
            seriesId: null,
            seriesIndex: null,
            seriesCount: null,
          },
          {
            id: 'b',
            startsAt: ukInstant('2026-10-01', '18:00').toISOString(),
            endsAt: ukInstant('2026-10-01', '23:00').toISOString(),
            allDay: false,
            seriesId: 'S',
            seriesIndex: 3,
            seriesCount: 6,
          },
        ]}
      />,
    );
    expect(html).toContain('Week of Mon 21 Sep');
    expect(html).toContain('Week of Mon 28 Sep');
    expect(html).toContain('Sun 27 Sep');
    expect(html).toContain('Thu 1 Oct · 18:00 – 23:00');
    expect(html).toContain('UK time');
    expect(html).toContain('Repeats weekly · 3 of 6');
    // No reason field anywhere (Q10).
    expect(html.toLowerCase()).not.toContain('reason');
  });
});

describe('addUnavailability()', () => {
  const day = {
    fromDate: '2099-01-01',
    toDate: null,
    fromTime: null,
    toTime: null,
    repeatWeeks: 0,
  };

  it('refuses what the phone can already see without a round trip', async () => {
    const result = await addUnavailability({ ...day, fromDate: '2020-01-01' });
    expect(result).toEqual({
      ok: false,
      message: 'That’s in the past. Pick today or a later date.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls the worker’s own RPC with UK dates and times, and no staff id', async () => {
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    rpc.mockResolvedValue({
      data: {
        ok: true,
        ids: ['x'],
        conflicts: [
          {
            bookingId: 'b1',
            event: 'Awards Night',
            role: 'Waiting Staff',
            venue: 'The Dorchester',
            startsAt: '2026-09-29T15:00:00Z',
            endsAt: '2026-09-30T01:00:00Z',
          },
        ],
      },
      error: null,
    });
    const result = await addUnavailability({
      ...day,
      fromDate: nextWeek,
      fromTime: '18:00',
      toTime: '23:00',
    });
    expect(rpc).toHaveBeenCalledWith('add_my_unavailability', {
      p_from_date: nextWeek,
      p_to_date: null,
      p_from_time: '18:00',
      p_to_time: '23:00',
      p_repeat_weeks: 0,
    });
    expect(result).toEqual({
      ok: true,
      saved: 1,
      conflicts: [
        {
          bookingId: 'b1',
          event: 'Awards Night',
          role: 'Waiting Staff',
          venue: 'The Dorchester',
          startsAt: '2026-09-29T15:00:00Z',
          endsAt: '2026-09-30T01:00:00Z',
        },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith('/profile/availability');
  });

  it('turns the database’s refusal into its sentence', async () => {
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    rpc.mockResolvedValue({ data: { ok: false, reason: 'too_many' }, error: null });
    const result = await addUnavailability({ ...day, fromDate: nextWeek });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/too many entries/);

    rpc.mockResolvedValue({ data: null, error: { message: 'not_editable' } });
    const leaver = await addUnavailability({ ...day, fromDate: nextWeek });
    expect(!leaver.ok && leaver.message).toMatch(/can’t be changed right now/);
  });
});

describe('removeUnavailability()', () => {
  it('deletes one or the series through the worker’s own RPC', async () => {
    rpc.mockResolvedValue({ data: { ok: true, removed: 4 }, error: null });
    expect(await removeUnavailability('e1', true)).toEqual({ ok: true, removed: 4 });
    expect(rpc).toHaveBeenCalledWith('remove_my_unavailability', {
      p_id: 'e1',
      p_whole_series: true,
    });
  });

  it('says so when the entry is not theirs or already gone', async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: 'not_found' }, error: null });
    expect(await removeUnavailability('e2', false)).toEqual({
      ok: false,
      message: 'That entry has already been deleted.',
    });
  });
});
