/**
 * What a file is, from its own first bytes (magic numbers).
 *
 * Two readers: the document extractor (onboarding/extractors/anthropic.ts),
 * which needs the media type the API is sent, and the upload "finish"
 * actions (stored-media.ts), which refuse an object whose bytes are not
 * what its name and declared type say — a browser's Content-Type is the
 * browser's claim, not a fact (security round 12.10, item 5).
 */

export type Media =
  | { kind: 'pdf' }
  | { kind: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }
  | { kind: 'unsupported'; reason: string };

/**
 * From the file's own first bytes, falling back to the declared type: the
 * Documents tab passes no MIME type and Storage may answer
 * `application/octet-stream`. HEIC (§2.5 allows it) is not an input the
 * API accepts, so it goes to a person.
 */
export function detectMedia(bytes: ArrayBuffer, declared: string): Media {
  const head = new Uint8Array(bytes.slice(0, 16));
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (ascii(0, 5) === '%PDF-') return { kind: 'pdf' };
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return { kind: 'image', mediaType: 'image/png' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { kind: 'image', mediaType: 'image/jpeg' };
  }
  if (ascii(0, 4) === 'GIF8') return { kind: 'image', mediaType: 'image/gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { kind: 'image', mediaType: 'image/webp' };
  }
  if (ascii(4, 8) === 'ftyp') return { kind: 'unsupported', reason: 'heic' };

  switch (declared.toLowerCase().split(';')[0]?.trim()) {
    case 'application/pdf':
      return { kind: 'pdf' };
    case 'image/jpeg':
    case 'image/jpg':
      return { kind: 'image', mediaType: 'image/jpeg' };
    case 'image/png':
      return { kind: 'image', mediaType: 'image/png' };
    case 'image/heic':
    case 'image/heif':
      return { kind: 'unsupported', reason: 'heic' };
    default:
      return { kind: 'unsupported', reason: 'unknown_type' };
  }
}
