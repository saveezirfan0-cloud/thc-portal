import type { SupabaseClient } from '@supabase/supabase-js';
import { detectMedia } from './media';

/**
 * Is the object a worker just uploaded what its name says it is?
 *
 * Every upload's type is decided twice before this: by the browser's
 * `File.type` (startUpload / startDocumentUpload) and by the Content-Type the
 * browser sent Storage with the bytes — which Storage records and
 * `evidence_upload_problem()` / `onboarding_attach_document()` then judge.
 * Both are the browser's claim. A crafted request can label an HTML page or
 * a script `application/pdf`, and the office opens these files.
 *
 * So the "finish" actions read the object's first bytes back from Storage
 * and run `detectMedia()` (the extractor's own magic-number check) against
 * the extension the server gave the object name — the extension is the
 * declared type, because the server built the name from it. A mismatch is
 * refused (and the object discarded where the caller can do that safely).
 *
 * Only the first few bytes are fetched (`Range`), never the 10 MB.
 */

export type StoredMediaVerdict = 'match' | 'mismatch' | 'unreadable';

/** How many bytes are enough for every signature `detectMedia` knows. */
const HEAD_BYTES = 32;

/** ISO-BMFF brands that are HEIC/HEIF stills — not an MP4 renamed .heic. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

function extensionOf(path: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  return match ? match[1]!.toLowerCase() : '';
}

/** Whether these first bytes are a file of the type the extension names. */
export function bytesMatchExtension(bytes: ArrayBuffer, ext: string): boolean {
  // Declared type '' on purpose: detectMedia's fallback to the declared
  // type is for the extractor; here only the bytes count.
  const media = detectMedia(bytes, '');
  switch (ext.toLowerCase()) {
    case 'pdf':
      return media.kind === 'pdf';
    case 'jpg':
    case 'jpeg':
      return media.kind === 'image' && media.mediaType === 'image/jpeg';
    case 'png':
      return media.kind === 'image' && media.mediaType === 'image/png';
    case 'heic':
    case 'heif': {
      if (media.kind !== 'unsupported' || media.reason !== 'heic') return false;
      const brand = String.fromCharCode(...new Uint8Array(bytes.slice(8, 12)));
      return HEIF_BRANDS.has(brand);
    }
    default:
      return false;
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function readHead(response: Response): Promise<ArrayBuffer> {
  // A server that ignores Range sends the whole object; stop reading as
  // soon as there is enough.
  const reader = response.body?.getReader();
  if (!reader) return (await response.arrayBuffer()).slice(0, HEAD_BYTES);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    length += value.byteLength;
  }
  void reader.cancel().catch(() => undefined);
  const head = new Uint8Array(Math.min(length, HEAD_BYTES));
  let at = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, head.byteLength - at);
    head.set(chunk.subarray(0, take), at);
    at += take;
    if (at >= head.byteLength) break;
  }
  return head.buffer;
}

/**
 * Read the first bytes of `bucket/path` through `client` and judge them
 * against the path's extension. `client` is whichever may read the object:
 * the service key for the `documents` bucket (no worker policy), the
 * worker's own session for `photos` (`photos_worker_read_own`). Never
 * throws; a read that fails is `unreadable`, which callers refuse.
 */
export async function checkStoredMedia(
  client: Pick<SupabaseClient, 'storage'>,
  bucket: string,
  path: string,
  fetchImpl: Fetch = fetch,
): Promise<StoredMediaVerdict> {
  try {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return 'unreadable';
    const response = await fetchImpl(data.signedUrl, {
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return 'unreadable';
    const head = await readHead(response);
    if (head.byteLength === 0) return 'unreadable';
    return bytesMatchExtension(head, extensionOf(path)) ? 'match' : 'mismatch';
  } catch {
    return 'unreadable';
  }
}
