import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §9.5 "Photo + name (the real selfie taken during onboarding)".
 *
 * `staff.photo_path` is a private-bucket object path, not a URL. The loader
 * must sign every path through the manager's own session (photos.ts) and
 * hand components a fetchable URL — never the path, which the browser
 * would resolve against the office origin and render as broken alt text.
 */

const PATH_A = '11111111-1111-4111-8111-111111111111/selfie-1700000000.jpg';
const PATH_B = '22222222-2222-4222-8222-222222222222/selfie-1700000001.jpg';
const signedUrl = (p: string) => `https://x.supabase.co/storage/v1/object/sign/photos/${p}?token=t`;

type SignResult = {
  data: { path: string | null; signedUrl: string | null }[] | null;
  error: { message: string } | null;
};
const createSignedUrls = vi.fn<(paths: string[], ttl: number) => Promise<SignResult>>(
  async (paths) => ({
    data: paths.map((path) => ({ path, signedUrl: signedUrl(path) })),
    error: null,
  }),
);

let monitorData: Record<string, unknown>[] = [];
let violationData: Record<string, unknown>[] = [];

const chain = (data: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'lte', 'order', 'limit']) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
  return q;
};

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    from: (table: string) => chain(table === 'checkin_monitor_v' ? monitorData : violationData),
    storage: { from: () => ({ createSignedUrls }) },
  }),
}));

const { deletedAccountLabel, loadMonitor } = await import('../data');

const monitorRow = (over: Record<string, unknown> = {}) => ({
  booking_id: 'b1',
  staff_id: 's1',
  event_id: 'e1',
  event_title: 'Afternoon Tea',
  role_name: 'Waiting Staff',
  staff_name: 'Sofia R.',
  photo_path: PATH_A,
  starts_at: '2026-09-18T14:00:00Z',
  ends_at: '2026-09-18T20:00:00Z',
  status: 'due',
  ...over,
});

const violationRow = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  booking_id: 'b1',
  type: 'late',
  detected_at: '2026-09-18T14:21:00Z',
  resolved: false,
  staff: {
    first_name: 'Chloe',
    last_name: 'D.',
    photo_path: PATH_B,
    removed_at: null,
    employee_id: 1042,
  },
  booking: { shift: { starts_at: '', ends_at: '' }, logs: [] },
  ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  createSignedUrls.mockClear();
  monitorData = [];
  violationData = [];
});

describe('§9.5 the loader signs the selfies', () => {
  it('hands the monitor and the log a signed URL, never the bucket path', async () => {
    monitorData = [monitorRow()];
    violationData = [violationRow()];
    const { rows, violations } = await loadMonitor();

    expect(rows[0]!.photoUrl).toBe(signedUrl(PATH_A));
    expect(violations[0]!.photoUrl).toBe(signedUrl(PATH_B));
    for (const url of [rows[0]!.photoUrl, violations[0]!.photoUrl]) {
      expect(url).not.toMatch(/^[0-9a-f-]{36}\//);
    }
  });

  it('signs each distinct path once, in one call', async () => {
    monitorData = [monitorRow(), monitorRow({ booking_id: 'b2' })];
    violationData = [violationRow({ staff: { ...violationRow().staff, photo_path: PATH_A } })];
    await loadMonitor();
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0]![0]).toEqual([PATH_A]);
  });

  it('keeps a removed worker at null and never signs their path', async () => {
    monitorData = [monitorRow({ staff_name: 'Deleted account #1042', photo_path: null })];
    violationData = [
      violationRow({ staff: { ...violationRow().staff, removed_at: '2026-09-01T00:00:00Z' } }),
    ];
    const { rows, violations } = await loadMonitor();
    expect(rows[0]!.photoUrl).toBeNull();
    expect(violations[0]!.photoUrl).toBeNull();
    expect(violations[0]!.staffName).toBe('Deleted account #1042');
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('falls back to initials (null) when signing fails, without losing the board', async () => {
    createSignedUrls.mockImplementationOnce(async () => ({
      data: null,
      error: { message: 'storage down' },
    }));
    monitorData = [monitorRow()];
    const { rows, problem } = await loadMonitor();
    expect(problem).toBeNull();
    expect(rows[0]!.photoUrl).toBeNull();
    expect(rows[0]!.staffName).toBe('Sofia R.');
  });
});

describe('§1.7 the removed-worker label', () => {
  it('prints #unknown, never #null, for a worker who never got an Employee ID', () => {
    expect(deletedAccountLabel(1042)).toBe('Deleted account #1042');
    expect(deletedAccountLabel(null)).toBe('Deleted account #unknown');
    expect(deletedAccountLabel(undefined)).toBe('Deleted account #unknown');
  });

  it('applies to a violation row whose removed worker has no Employee ID', async () => {
    violationData = [
      violationRow({
        staff: { ...violationRow().staff, removed_at: '2026-09-01T00:00:00Z', employee_id: null },
      }),
    ];
    const { violations } = await loadMonitor();
    expect(violations[0]!.staffName).toBe('Deleted account #unknown');
  });

  it('covers the view’s NULL staff_name for the same case', async () => {
    // The view spells the label with `||`, which is NULL without an ID.
    monitorData = [monitorRow({ staff_name: null, photo_path: null })];
    const { rows } = await loadMonitor();
    expect(rows[0]!.staffName).toBe('Deleted account #unknown');
  });
});
