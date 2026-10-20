import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, fakePostgrest } from '../../_lib/__tests__/fakePostgrest';

/**
 * The directory names everybody (go-live audit 17.10.2026, B3). PostgREST
 * cuts a view at 1000 rows without an error; the directory sorted by name,
 * so whoever came last in the alphabet vanished from the list, its search,
 * its filter counts and the Send push picker.
 */

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => state.db }));

const { loadStaff } = await import('../data');

const pad = (n: number) => String(n).padStart(4, '0');
const STAFF = Array.from({ length: 2150 }, (_, n) => ({
  id: `w-${pad(n)}`,
  display_name: `Worker ${pad(n)}`,
  photo_path: n % 2 ? `w-${pad(n)}/selfie.jpg` : null,
}));
const STUDENTS = STAFF.slice(0, 1010).map((row) => ({ ...row }));
const PHONES = STAFF.map((row, n) => ({ id: row.id, phone: `+4477009${pad(n)}0` }));

let fake: ReturnType<typeof fakePostgrest>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  fake = fakePostgrest({ staff_directory_v: STAFF, student_visa_v: STUDENTS, staff: PHONES });
  state.db = fake;
});

describe('loadStaff', () => {
  it('reads all 2,150 people and all 1,010 students, past the 1,000-row cap', async () => {
    const data = await loadStaff();
    expect(data.problem).toBeNull();
    expect(data.staff).toHaveLength(2150);
    expect(data.staff.at(-1)?.display_name).toBe('Worker 2149');
    expect(data.students).toHaveLength(1010);
  });

  it('pages by name then id, so no two rows tie across a page boundary', async () => {
    await loadStaff();
    const pages = callsTo(fake.calls, 'staff_directory_v');
    expect(pages.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(pages[0]!.orders.map(([column]) => column)).toEqual(['display_name', 'id']);
  });

  it('still signs the faces of people past row 1,000', async () => {
    const data = await loadStaff();
    expect(data.staff[2149]?.photo_url).toBe('https://signed/w-2149/selfie.jpg');
    expect(data.staff[2148]?.photo_url).toBeNull();
  });

  it('carries every phone, read off staff past the 1,000-row cap, never a removed one', async () => {
    state.db = fakePostgrest({
      staff_directory_v: STAFF.map((row, n) => ({ ...row, removed: n === 5 })),
      student_visa_v: STUDENTS,
      staff: PHONES,
    });
    const data = await loadStaff();
    expect(data.staff[2149]?.phone).toBe('+447700921490');
    expect(data.staff[0]?.phone).toBe('+447700900000');
    expect(data.staff[5]?.phone).toBeNull();
    const pages = callsTo((state.db as typeof fake).calls, 'staff');
    expect(pages).toHaveLength(3);
    expect(pages[0]!.select).toBe('id, phone');
    expect(pages[0]!.filters).toEqual([['is', 'removed_at', null]]);
  });

  it('a failed phone read leaves the column empty, not the directory', async () => {
    state.db = fakePostgrest(
      { staff_directory_v: STAFF, student_visa_v: STUDENTS },
      { errors: { staff: { message: 'no phones' } } },
    );
    const data = await loadStaff();
    expect(data.problem).toBeNull();
    expect(data.staff).toHaveLength(2150);
    expect(data.staff[0]?.phone).toBeUndefined();
  });

  it('a page that fails is a problem, not a short directory', async () => {
    state.db = fakePostgrest(
      { student_visa_v: STUDENTS },
      { errors: { staff_directory_v: { message: 'the view failed' } } },
    );
    const data = await loadStaff();
    expect(data.staff).toEqual([]);
    expect(data.problem).toBe('the view failed');
  });
});
