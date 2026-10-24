'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';
import { PDFDocument, degrees } from 'pdf-lib';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import { READ_ONLY_MESSAGE, officeMayWrite, sessionIsAdmin } from '../_lib/sessionRole';
import { supabaseConfigured } from '../staff/data';
import type { ActionResult } from './types';

/**
 * "Rotate" on a Needs review row (ADR-0212, TK-18): a photo that came in
 * sideways or upside down is turned and kept that way, so the office
 * verifies it instead of rejecting it and asking for it again. Since TK-30
 * the reviewer turns it in a preview window first and saves the net turn
 * (90, 180 or 270 clockwise) once. The AI read already turns most of them on upload; this is
 * for the rest.
 *
 * The row is read through the manager's session; the turned copy is
 * written beside the original with the service key and swapped in by
 * `turn_document_upright()` as the manager (office, may write, still
 * pending, same file, a photo). If the database refuses, the copy is
 * removed again.
 */

const REFUSALS: Record<string, string> = {
  not_pending: 'This document has already been decided, so it can no longer be turned.',
  file_changed: 'A newer file was uploaded meanwhile. Refresh and look again.',
  not_a_photo: 'Only a photo (JPG or PNG) or a PDF can be turned.',
  read_only: READ_ONLY_MESSAGE,
};

/** Clockwise, as chosen in the preview window (TK-30). */
type QuarterTurn = 90 | 180 | 270;

/** `turn_document_upright()` (20261027110000), not yet in the generated types. */
interface TurnRpc {
  rpc(
    fn: 'turn_document_upright',
    args: { p_doc: string; p_from: string; p_to: string; p_size: number; p_turned: QuarterTurn },
  ): PromiseLike<{ error: { message?: string } | null }>;
}

export async function rotateDocument(docId: string, turn: QuarterTurn = 90): Promise<ActionResult> {
  if (turn !== 90 && turn !== 180 && turn !== 270) {
    return { ok: false, message: 'Turn by a quarter, a half or three quarters.' };
  }
  if (!supabaseConfigured())
    return { ok: false, message: 'This environment has no Supabase project.' };
  const supabase = createClient(await cookies());
  if (!(await sessionIsAdmin(supabase))) {
    return { ok: false, message: 'Only the office can turn a document.' };
  }
  if (!(await officeMayWrite(supabase))) return { ok: false, message: READ_ONLY_MESSAGE };

  const { data: doc } = await supabase
    .from('compliance_docs')
    .select('file_path, mime_type, review_status')
    .eq('id', docId)
    .maybeSingle<{ file_path: string | null; mime_type: string | null; review_status: string }>();
  if (!doc?.file_path) return { ok: false, message: 'There is no file on this document.' };
  if (doc.review_status !== 'pending') return { ok: false, message: REFUSALS['not_pending']! };
  const pdf = doc.mime_type === 'application/pdf';
  if (!pdf && doc.mime_type !== 'image/jpeg' && doc.mime_type !== 'image/png') {
    return { ok: false, message: REFUSALS['not_a_photo']! };
  }

  const admin = createAdminClient();
  const from = doc.file_path;
  const { data: file } = await admin.storage.from('documents').download(from);
  if (!file) return { ok: false, message: 'The file could not be read. Try again in a minute.' };

  let turned: Buffer;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    turned = pdf ? await turnPdfClockwise(bytes, turn) : await turnPhotoClockwise(bytes, turn);
  } catch {
    return {
      ok: false,
      message: 'This photo could not be turned. Ask the worker to upload it again.',
    };
  }

  const to = `${from.slice(0, from.lastIndexOf('/'))}/${randomUUID()}.${pdf ? 'pdf' : 'jpg'}`;
  const { error: uploadError } = await admin.storage
    .from('documents')
    .upload(to, turned, { contentType: pdf ? 'application/pdf' : 'image/jpeg' });
  if (uploadError) return { ok: false, message: 'The turned photo could not be saved. Try again.' };

  const { error } = await (supabase as unknown as TurnRpc).rpc('turn_document_upright', {
    p_doc: docId,
    p_from: from,
    p_to: to,
    p_size: turned.byteLength,
    p_turned: turn,
  });
  if (error) {
    await admin.storage.from('documents').remove([to]);
    const code = Object.keys(REFUSALS).find((key) => error.message?.includes(key));
    return {
      ok: false,
      message: code ? REFUSALS[code]! : 'The photo could not be turned. Try again.',
    };
  }

  revalidatePath('/compliance');
  revalidatePath('/staff', 'layout');
  revalidatePath('/onboarding', 'layout');
  return { ok: true, message: 'Saved the right way round.' };
}

/** A photo turned clockwise, its camera orientation applied first, as a JPEG. */
async function turnPhotoClockwise(bytes: Buffer, turn: QuarterTurn): Promise<Buffer> {
  return sharp(bytes).autoOrient().rotate(turn).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/**
 * ADR-0214 (TK-24): every page of a PDF turned clockwise — its
 * /Rotate, so nothing on the page is re-compressed or re-drawn.
 */
async function turnPdfClockwise(bytes: Buffer, turn: QuarterTurn): Promise<Buffer> {
  const doc = await PDFDocument.load(bytes);
  for (const page of doc.getPages()) {
    page.setRotation(degrees((page.getRotation().angle + turn) % 360));
  }
  return Buffer.from(await doc.save());
}
