import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { putSignedUpload } from '../signed-upload';

/**
 * Go-live audit L1 · an upload is one PUT to a signed URL the server
 * issued, not the Supabase browser client (54 KB gzipped) loaded for its
 * `uploadToSignedUrl`.
 */

const URL_ =
  'https://abc.supabase.co/storage/v1/object/upload/sign/documents/s1/passport/a.pdf?token=t';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('putSignedUpload', () => {
  it('PUTs the bytes with the type Storage records, and never replaces an object', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    const fetchImpl = vi.fn(async () => new Response('{"Key":"x"}', { status: 200 }));
    const file = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    expect(await putSignedUpload(URL_, file, 'application/pdf', fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(URL_, {
      method: 'PUT',
      body: file,
      headers: {
        'content-type': 'application/pdf',
        'x-upsert': 'false',
        'cache-control': 'max-age=3600',
        apikey: 'anon-key',
      },
    });
  });

  it('sends no apikey header when the environment has none', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }),
    );
    await putSignedUpload(URL_, new Blob(['x']), 'image/jpeg', fetchImpl as never);
    expect(fetchImpl.mock.calls[0]![1].headers).not.toHaveProperty('apikey');
  });

  it.each([
    ['Storage refuses (an object already there, a type the bucket refuses)', 400],
    ['an expired token', 403],
    ['a gateway timeout', 504],
  ])('is false when %s', async (_label, status) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status }));
    expect(await putSignedUpload(URL_, new Blob(['x']), 'image/png', fetchImpl)).toBe(false);
  });

  it('is false, not a throw, when there is no signal', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await putSignedUpload(URL_, new Blob(['x']), 'image/png', fetchImpl)).toBe(false);
  });
});

/**
 * The upload screens stay off the browser client. Profile details and its
 * change requests (app/profile/**) still use it; they are a separate
 * change.
 */
const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(?:ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the upload screens load no Supabase client in the browser', () => {
  it.each(['documents', 'onboarding'])('app/%s imports nothing from @thc/db/browser', (tree) => {
    const offenders = sources(join(APP, tree))
      .filter((file) => /from ['"]@thc\/db\/browser['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(APP, file));
    expect(offenders).toEqual([]);
  });
});
