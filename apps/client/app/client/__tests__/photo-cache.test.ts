import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stable photo links (R2). The pages re-render every minute (AutoRefresh);
 * re-signing every face each time gave every photo a new URL, so the
 * browser re-downloaded them all and the faces flickered. A signed link is
 * now reused until half its ten-minute life has gone, the store is bounded,
 * and only the faces a screen draws are signed.
 */
const state = vi.hoisted(() => ({ batches: [] as string[][], n: 0 }));

vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          state.batches.push([...paths]);
          state.n += 1;
          return {
            data: paths.map((path) => ({
              path,
              signedUrl: `https://signed.test/${path}?t=${state.n}`,
            })),
            error: null,
          };
        },
      }),
    },
  }),
}));

const { photoUrls, presentLineup, signedUrlCache } = await import('../photos');
type Record_ = Parameters<typeof presentLineup>[0][number];

const row = (bookingId: string, photoPath: string | null): Record_ => ({
  bookingId,
  eventId: 'e1',
  shiftId: null,
  role: 'Waiting',
  startsAt: 'a',
  endsAt: 'b',
  name: bookingId,
  sortKey: bookingId,
  feedbackGiven: false,
  feedbackRating: null,
  feedbackSentAt: null,
  photoPath,
});

const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
});
afterAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
  photoUrls.clear();
  state.batches = [];
  state.n = 0;
});

describe('signedUrlCache', () => {
  it('reuses a link until reuseMs has passed, then forgets it', () => {
    let t = 0;
    const cache = signedUrlCache({ max: 10, reuseMs: 300_000, now: () => t });
    cache.set('p', 'url-1');
    t = 299_999;
    expect(cache.get('p')).toBe('url-1');
    t = 300_000;
    expect(cache.get('p')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('is bounded, dropping the least recently used first', () => {
    const cache = signedUrlCache({ max: 2, reuseMs: 1_000, now: () => 0 });
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.get('a')).toBe('1'); // a is now the most recent
    cache.set('c', '3');
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('1');
    expect(cache.get('c')).toBe('3');
  });
});

describe('presentLineup', () => {
  const rows = [row('b1', 'staff-1/a.jpg'), row('b2', 'staff-2/b.jpg'), row('b3', null)];

  it('hands out the same URL on the next minute’s render, without signing again', async () => {
    const first = await presentLineup(rows);
    vi.advanceTimersByTime(60_000);
    const second = await presentLineup(rows);
    expect(second.photos).toEqual(first.photos);
    expect(state.batches).toEqual([['staff-1/a.jpg', 'staff-2/b.jpg']]);
  });

  it('re-signs once half the ten-minute life has gone', async () => {
    const first = await presentLineup(rows);
    vi.advanceTimersByTime(5 * 60_000);
    const later = await presentLineup(rows);
    expect(later.photos.b1).not.toBe(first.photos.b1);
    expect(state.batches).toHaveLength(2);
  });

  it('signs only what is missing from the store', async () => {
    await presentLineup([rows[0]!]);
    await presentLineup(rows);
    expect(state.batches).toEqual([['staff-1/a.jpg'], ['staff-2/b.jpg']]);
  });

  it('signs only the faces drawn, and still hands over the whole line-up', async () => {
    const out = await presentLineup(rows, [rows[1]!]);
    expect(state.batches).toEqual([['staff-2/b.jpg']]);
    expect(Object.keys(out.photos)).toEqual(['b2']);
    expect(out.lineup.map((r) => r.bookingId)).toEqual(['b1', 'b2', 'b3']);
  });
});
