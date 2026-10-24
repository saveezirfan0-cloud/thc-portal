import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { DocType } from '@thc/domain';

/**
 * ADR-0212 (TK-18) — a document photo turned the right way up.
 *
 * The reader sees the photo with its camera orientation already applied
 * (`bakeOrientation`), the way a browser shows it, and answers how far it
 * must turn clockwise to read the right way up. `turnClockwise` makes that
 * copy; `turn_document_upright()` swaps it in. Photos only — a PDF or HEIC
 * is never touched — and never the gov.uk report or the Home Office result,
 * which are not photos the worker took.
 */

export type QuarterTurn = 90 | 180 | 270;

const PHOTO_MIME = new Set(['image/jpeg', 'image/png']);
const NEVER_TURNED: ReadonlySet<DocType> = new Set([
  'share_code_report',
  'home_office_check_result',
]);

export function turnable(docType: DocType, mimeType: string): boolean {
  return PHOTO_MIME.has(mimeType) && !NEVER_TURNED.has(docType);
}

/** A JPEG the size and quality a reviewer needs, metadata (and its orientation tag) dropped. */
const JPEG = { quality: 90, mozjpeg: true } as const;

/**
 * The camera's orientation tag applied to the pixels, so what the reader
 * sees is what a browser shows. Unchanged bytes when there is no tag.
 */
export async function bakeOrientation(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const input = Buffer.from(bytes);
  const { orientation } = await sharp(input).metadata();
  if (!orientation || orientation === 1) return bytes;
  return toArrayBuffer(await sharp(input).autoOrient().jpeg(JPEG).toBuffer());
}

/** The photo turned clockwise by a quarter, half or three-quarter turn, as a JPEG. */
export async function turnClockwise(
  bytes: ArrayBuffer,
  degrees: QuarterTurn,
): Promise<ArrayBuffer> {
  return toArrayBuffer(
    await sharp(Buffer.from(bytes)).autoOrient().rotate(degrees).jpeg(JPEG).toBuffer(),
  );
}

/** Where the upright copy goes: beside the original, a new name (the original is purged). */
export function uprightPath(from: string): string {
  return `${from.slice(0, from.lastIndexOf('/'))}/${randomUUID()}.jpg`;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
