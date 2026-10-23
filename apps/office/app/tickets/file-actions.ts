'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import { explainDbError } from '../_lib/dbError';
import { READ_ONLY_MESSAGE, officeMayWrite, sessionIsAdmin } from '../_lib/sessionRole';
import { supabaseConfigured } from './data';
import { FILES_PER_TICKET, fileProblem, objectPath } from './ticket-files';
import type { FileMeta, TicketFileKind } from './ticket-files';

/**
 * Uploads for the Ticket button (ADR-0204). The browser never writes to
 * Storage on its own authority: the first action checks the caller filed this
 * ticket (the database's `ticket_file_allowed`) and issues a one-object
 * signed upload URL with the service key; the browser PUTs the file to it;
 * the second action asks `attach_ticket_file` to register what Storage
 * recorded. The object name is built here, never by the browser.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'ticket-files';

const NOT_CONFIGURED =
  'This environment has no Supabase project, so files cannot be saved. See docs/04-setup-github-vercel-supabase.md.';
const NO_SERVICE_KEY = 'Set SUPABASE_SERVICE_ROLE_KEY for the Back Office to upload files.';
const NOT_YOURS =
  'Files can only be added by the person who sent the ticket, within the hour, up to five.';

/** The generated Database type does not know these functions until `gen:types` is run (as in actions.ts). */
interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, string>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export type UploadSlot =
  { ok: true; path: string; signedUrl: string } | { ok: false; message: string };

export type AttachResult = { ok: true } | { ok: false; message: string };

function refusal(error: { message: string; code?: string }): string {
  return explainDbError(error, {
    log: '[ticket-files]',
    codes: {
      cannot_attach: NOT_YOURS,
      unknown_ticket: 'That ticket no longer exists.',
      file_not_found: 'The file did not reach storage. Try again.',
      bad_file_kind: 'That file does not match what it was filed as.',
      bad_file_path: 'That file does not belong to this ticket.',
    },
  });
}

/** Step one: may this login add a file to this ticket, and where should it be sent? */
export async function startTicketFileUpload(ticketId: string, file: FileMeta): Promise<UploadSlot> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!UUID.test(ticketId)) return { ok: false, message: 'That ticket no longer exists.' };
  const problem = fileProblem(file);
  if (problem) return { ok: false, message: problem };

  const supabase = createClient(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: 'Your session has ended. Sign in again.' };
  if (!(await officeMayWrite(supabase))) {
    return {
      ok: false,
      message: (await sessionIsAdmin(supabase)) ? READ_ONLY_MESSAGE : NOT_YOURS,
    };
  }
  const { data: allowed, error } = await (supabase as unknown as RpcClient).rpc(
    'ticket_file_allowed',
    {
      p_ticket: ticketId,
    },
  );
  if (error) return { ok: false, message: refusal(error) };
  if (allowed !== true) return { ok: false, message: NOT_YOURS };

  const path = objectPath(ticketId, randomUUID(), file.type);
  if (!path) return { ok: false, message: fileProblem(file) ?? NOT_YOURS };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, message: NO_SERVICE_KEY };
  }
  // An object that was uploaded but never attached has no row, so the five-file
  // limit is also counted in Storage before another URL is handed out.
  const { data: held } = await admin.storage.from(BUCKET).list(ticketId, { limit: 10 });
  if ((held?.length ?? 0) >= FILES_PER_TICKET) return { ok: false, message: NOT_YOURS };
  const { data, error: signError } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signError || !data) return { ok: false, message: 'Could not start the upload. Try again.' };
  return { ok: true, path: data.path, signedUrl: data.signedUrl };
}

/** Step two: the file is in Storage; register it on the ticket. */
export async function finishTicketFile(
  ticketId: string,
  path: string,
  kind: TicketFileKind,
  name: string,
): Promise<AttachResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!UUID.test(ticketId)) return { ok: false, message: 'That ticket no longer exists.' };
  const supabase = createClient(await cookies());
  const { error } = await (supabase as unknown as RpcClient).rpc('attach_ticket_file', {
    p_ticket: ticketId,
    p_path: path,
    p_kind: kind,
    p_name: typeof name === 'string' ? name.slice(0, 200) : '',
  });
  if (error) return { ok: false, message: refusal(error) };
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}
