import sharp from 'sharp';
import { PDFDocument, degrees } from 'pdf-lib';
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
      message: 'Saved the right way round.',
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

  it('turns every page of a PDF a quarter clockwise, and it stays a PDF (ADR-0214, TK-24)', async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 400]);
    source.addPage([600, 400]).setRotation(degrees(270));
    storage.download.mockResolvedValue({
      data: new Blob([new Uint8Array(await source.save())]),
      error: null,
    });
    const pdfPath = PATH.replace('.jpg', '.pdf');
    doc.current = { file_path: pdfPath, mime_type: 'application/pdf', review_status: 'pending' };

    expect((await rotateDocument('d1')).ok).toBe(true);
    const [to, body, options] = storage.upload.mock.calls[0] as [string, Buffer, object];
    expect(to).toMatch(/^93900000-0000-4000-8000-000000000001\/passport\/[0-9a-f-]{36}\.pdf$/);
    expect(options).toEqual({ contentType: 'application/pdf' });
    const turned = await PDFDocument.load(body);
    expect(turned.getPages().map((page) => page.getRotation().angle)).toEqual([90, 0]);
    expect(rpc).toHaveBeenCalledWith(
      'turn_document_upright',
      expect.objectContaining({ p_from: pdfPath, p_to: to, p_turned: 90 }),
    );
  });

  it('turns the net angle chosen in the preview, in one save (TK-30)', async () => {
    expect((await rotateDocument('d1', 180)).ok).toBe(true);
    let [, body] = storage.upload.mock.calls[0] as [string, Buffer];
    expect(await sharp(body).metadata()).toMatchObject({ width: 20, height: 40 });
    expect(rpc).toHaveBeenLastCalledWith(
      'turn_document_upright',
      expect.objectContaining({ p_turned: 180 }),
    );

    expect((await rotateDocument('d1', 270)).ok).toBe(true);
    [, body] = storage.upload.mock.calls[1] as [string, Buffer];
    expect(await sharp(body).metadata()).toMatchObject({ width: 40, height: 20 });
    expect(rpc).toHaveBeenLastCalledWith(
      'turn_document_upright',
      expect.objectContaining({ p_turned: 270 }),
    );
  });

  it('a PDF page already turned keeps adding up, past a full circle (TK-30)', async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 400]).setRotation(degrees(90));
    storage.download.mockResolvedValue({
      data: new Blob([new Uint8Array(await source.save())]),
      error: null,
    });
    doc.current = {
      file_path: PATH.replace('.jpg', '.pdf'),
      mime_type: 'application/pdf',
      review_status: 'pending',
    };
    expect((await rotateDocument('d1', 270)).ok).toBe(true);
    const [, body] = storage.upload.mock.calls[0] as [string, Buffer];
    const turned = await PDFDocument.load(body);
    expect(turned.getPages().map((page) => page.getRotation().angle)).toEqual([0]);
  });

  it('refuses any angle but a quarter, half or three-quarter turn, before touching the file', async () => {
    for (const bad of [0, 45, 360, -90]) {
      expect((await rotateDocument('d1', bad as 90)).ok).toBe(false);
    }
    expect(storage.download).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never touches a HEIC or a decided document, and a viewer changes nothing', async () => {
    doc.current = { file_path: PATH, mime_type: 'image/heic', review_status: 'pending' };
    expect((await rotateDocument('d1')).message).toBe(
      'Only a photo (JPG or PNG) or a PDF can be turned.',
    );
    doc.current = { file_path: PATH, mime_type: 'image/jpeg', review_status: 'verified' };
    expect((await rotateDocument('d1')).ok).toBe(false);
    role.write = false;
    expect((await rotateDocument('d1')).message).toBe('read only');
    expect(storage.download).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
