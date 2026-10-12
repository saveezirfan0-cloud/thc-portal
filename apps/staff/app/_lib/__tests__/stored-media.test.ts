import { describe, expect, it, vi } from 'vitest';
import { bytesMatchExtension, checkStoredMedia } from '../stored-media';

/**
 * Security round 12.10, item 5: an upload's type is the browser's claim
 * until its own bytes say so. `checkStoredMedia` reads the first bytes of
 * the stored object (a Range request on a short-lived signed URL) and
 * judges them, with `detectMedia`, against the extension the server put in
 * the object's name.
 */

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  ).buffer;

const PDF = bytes('%PDF-1.7\n', [0, 0, 0, 0, 0, 0, 0]);
const PNG = bytes([0x89], 'PNG\r\n', [0x1a, 0x0a], [0, 0, 0, 0, 0, 0, 0, 0]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const HEIC = bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0]);
const MP4 = bytes([0, 0, 0, 0x18], 'ftypisom', [0, 0, 0, 0]);
const HTML = bytes('<!doctype html><script>');

describe('bytesMatchExtension', () => {
  it('passes each accepted type under its own name', () => {
    expect(bytesMatchExtension(PDF, 'pdf')).toBe(true);
    expect(bytesMatchExtension(PNG, 'png')).toBe(true);
    expect(bytesMatchExtension(JPEG, 'jpg')).toBe(true);
    expect(bytesMatchExtension(JPEG, 'jpeg')).toBe(true);
    expect(bytesMatchExtension(HEIC, 'heic')).toBe(true);
  });

  it('refuses bytes that are not what the name says — whatever the browser declared', () => {
    expect(bytesMatchExtension(HTML, 'pdf')).toBe(false);
    expect(bytesMatchExtension(PNG, 'pdf')).toBe(false);
    expect(bytesMatchExtension(PDF, 'jpg')).toBe(false);
    expect(bytesMatchExtension(JPEG, 'png')).toBe(false);
    expect(bytesMatchExtension(MP4, 'heic')).toBe(false);
    expect(bytesMatchExtension(PDF, 'exe')).toBe(false);
  });
});

function client(signed: { data: { signedUrl: string } | null; error: unknown }) {
  const createSignedUrl = vi.fn(async () => signed);
  return {
    createSignedUrl,
    client: { storage: { from: vi.fn(() => ({ createSignedUrl })) } } as never,
  };
}

describe('checkStoredMedia', () => {
  it('asks for the first bytes only, and matches', async () => {
    const { client: c, createSignedUrl } = client({
      data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/documents/a.pdf?token=t' },
      error: null,
    });
    const fetchMock = vi.fn(async () => new Response(PDF, { status: 206 }));
    expect(await checkStoredMedia(c, 'documents', 's1/passport/a.pdf', fetchMock)).toBe('match');
    expect(createSignedUrl).toHaveBeenCalledWith('s1/passport/a.pdf', 60);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Range']).toBe('bytes=0-31');
  });

  it('an HTML page stored as .pdf is a mismatch', async () => {
    const { client: c } = client({ data: { signedUrl: 'https://x/s' }, error: null });
    const fetchMock = async () => new Response(HTML, { status: 200 });
    expect(await checkStoredMedia(c, 'documents', 's1/passport/a.pdf', fetchMock)).toBe('mismatch');
  });

  it('a read that fails is unreadable, never a pass', async () => {
    const refused = client({ data: null, error: { message: 'Object not found' } });
    expect(await checkStoredMedia(refused.client, 'photos', 's1/selfie-1.jpg', vi.fn())).toBe(
      'unreadable',
    );
    const ok = client({ data: { signedUrl: 'https://x/s' }, error: null });
    expect(
      await checkStoredMedia(ok.client, 'photos', 's1/selfie-1.jpg', async () => {
        throw new Error('network');
      }),
    ).toBe('unreadable');
    expect(
      await checkStoredMedia(
        ok.client,
        'photos',
        's1/selfie-1.jpg',
        async () => new Response('', { status: 404 }),
      ),
    ).toBe('unreadable');
  });
});
