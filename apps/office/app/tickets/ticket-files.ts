/**
 * Files on a ticket (ADR-0204): the pure half. What may be attached, what a
 * file is called in Storage and what kind of file it is. The database holds
 * the same limits (20261026110000: the bucket's size and type list,
 * `attach_ticket_file`'s kind check and five-file cap); this only says so
 * earlier and in words.
 */

export const FILE_MAX_BYTES = 50 * 1024 * 1024;
export const FILES_PER_TICKET = 5;
/** A screen recording stops by itself here, so it fits under FILE_MAX_BYTES. */
export const RECORDING_MAX_SECONDS = 180;
/** Video bits per second for a recording: 3 minutes ≈ 34 MB at this rate. */
export const RECORDING_BITS_PER_SECOND = 1_500_000;

export type TicketFileKind = 'screenshot' | 'video' | 'recording';

/** The types the bucket takes, and the extension each is stored under. */
export const FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/** `video/webm;codecs=vp9` → `video/webm`. What a recorder reports is not what Storage is told. */
export function baseMime(type: string): string {
  return (type.split(';')[0] ?? '').trim().toLowerCase();
}

export function isAcceptedType(type: string): boolean {
  return baseMime(type) in FILE_EXTENSIONS;
}

/** The extension an object is stored under, or null for a type the bucket refuses. */
export function extensionFor(type: string): string | null {
  return FILE_EXTENSIONS[baseMime(type)] ?? null;
}

/** A picture is a screenshot; a video is a video unless it came from the recorder. */
export function kindFor(type: string, recorded = false): TicketFileKind | null {
  const base = baseMime(type);
  if (!(base in FILE_EXTENSIONS)) return null;
  if (base.startsWith('image/')) return 'screenshot';
  return recorded ? 'recording' : 'video';
}

export interface FileMeta {
  name: string;
  type: string;
  size: number;
}

/** What is wrong with a file before it is sent, in the reporter's words; null when it can go. */
export function fileProblem(meta: FileMeta): string | null {
  if (!isAcceptedType(meta.type)) {
    return `${meta.name || 'That file'} is not a picture or a video we can keep. Use PNG, JPEG, WebP, GIF, MP4, WebM or MOV.`;
  }
  if (meta.size <= 0) return `${meta.name || 'That file'} is empty.`;
  if (meta.size > FILE_MAX_BYTES) {
    return `${meta.name || 'That file'} is over ${FILE_MAX_BYTES / (1024 * 1024)} MB. Record a shorter clip, or paste a link instead.`;
  }
  return null;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The ticket folder and file name an upload lands under: `<ticket id>/<uuid>.<ext>`. */
export function objectPath(ticketId: string, uuid: string, type: string): string | null {
  const ext = extensionFor(type);
  return ext ? `${ticketId}/${uuid}.${ext}` : null;
}
