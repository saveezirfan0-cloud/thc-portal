import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0212 (TK-18): Rotate on Needs review turns a photo a quarter clockwise
 * and swaps the copy in through `turn_document_upright()`. A real image
 * through real sharp; Storage and the database are fakes.
 */
const rpc = vi.hoisted(() => vi.fn());
const doc = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const storage = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));
const role = vi.hoisted(() => ({ admin: true, write: true }));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../staff/data', () => ({ supabaseConfigured: () => true }));
vi.mock('../../_lib/sessionRole', () => ({
  READ_ONLY_MESSAGE: 'read only',
  sessionIsAdmin: async () => role.admin,
  officeMayWrite: async () => role.write,
}));
vi.mock('@thc/db/server', () => ({
  createClient: vi.fn(() => ({
    rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: doc.current }) }) }),
    }),
  })),
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: vi.fn(() => ({ storage: { from: () => storage } })),
}));

const { rotateDocument } = await import('../rotateActions');

const PATH =
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg';

beforeEach(async () => {
  role.admin = true;
  role.write = true;
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  doc.current = { file_path: PATH, mime_type: 'image/jpeg', review_status: 'pending' };
  const portrait = await sharp({
    create: { width: 20, height: 40, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toBuffer();
  storage.download.mockReset();
  storage.download.mockResolvedValue({ data: new Blob([new Uint8Array(portrait)]), error: null });
  storage.upload.mockReset();
  storage.upload.mockResolvedValue({ data: {}, error: null });
  storage.remove.mockReset();
  storage.remove.mockResolvedValue({ data: [], error: null });
});

describe('rotateDocument', () => {
  it('turns the photo a quarter clockwise and swaps it in as the manager', async () => {
    const result = await rotateDocument('d1');
    expect(result).toEqual({
      ok: true,
      message: 'Turned a quarter clockwise. Press View to check it.',
    });

    const [to, body, options] = storage.upload.mock.calls[0] as [string, Buffer, object];
    expect(to).toMatch(/^93900000-0000-4000-8000-000000000001\/passport\/[0-9a-f-]{36}\.jpg$/);
    expect(options).toEqual({ contentType: 'image/jpeg' });
    expect(await sharp(body).metadata()).toMatchObject({ width: 40, height: 20, format: 'jpeg' });
    expect(rpc).toHaveBeenCalledWith('turn_document_upright', {
      p_doc: 'd1',
      p_from: PATH,
      p_to: to,
      p_size: body.byteLength,
      p_turned: 90,
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('removes the copy and says why when the database refuses', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_pending' } });
    const result = await rotateDocument('d1');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('already been decided');
    const [to] = storage.upload.mock.calls[0] as [string];
    expect(storage.remove).toHaveBeenCalledWith([to]);
  });

  it('never touches a PDF or a decided document, and a viewer changes nothing', async () => {
    doc.current = { file_path: PATH, mime_type: 'application/pdf', review_status: 'pending' };
    expect((await rotateDocument('d1')).message).toBe('Only a photo (JPG or PNG) can be turned.');
    doc.current = { file_path: PATH, mime_type: 'image/jpeg', review_status: 'verified' };
    expect((await rotateDocument('d1')).ok).toBe(false);
    role.write = false;
    expect((await rotateDocument('d1')).message).toBe('read only');
    expect(storage.download).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
