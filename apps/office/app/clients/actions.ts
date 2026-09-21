'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from './data';
import { validateClient } from './validate';
import type { ActionResult, ClientDraft } from './types';

/**
 * Writes for /clients (§9.7), through the RPCs in
 * 20260921160000_clients_directory.sql.
 *
 * There is no delete action, and there is no delete function behind one:
 * §9.7 says a client record cannot be removed from the system, only
 * edited, and `140_clients_directory.sql` asserts the function's absence.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so clients cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

/** See the note in the roles actions: the generated types are a placeholder. */
type RpcArguments = Record<string, string | number | boolean | string[] | null>;

interface RpcClient {
  rpc(fn: string, args: RpcArguments): PromiseLike<{ error: { message: string } | null }>;
}

async function callRpc(fn: string, args: RpcArguments): Promise<ActionResult> {
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };

  revalidatePath('/clients');
  return { ok: true };
}

function args(draft: ClientDraft): RpcArguments {
  return {
    p_name: draft.name.trim(),
    p_contact_name: draft.contact_name.trim(),
    p_phone: draft.phone.trim(),
    p_staff_contact_point: draft.staff_contact_point.trim(),
    p_contact_emails: draft.contact_emails.map((email) => email.trim()),
    p_pays_breaks: draft.pays_breaks,
    p_pays_buffer: draft.pays_buffer,
  };
}

export async function createClientRecord(draft: ClientDraft): Promise<ActionResult> {
  const invalid = validateClient(draft);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  return callRpc('create_client', args(draft));
}

export async function updateClientRecord(id: string, draft: ClientDraft): Promise<ActionResult> {
  const invalid = validateClient(draft);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  return callRpc('update_client', { p_id: id, ...args(draft) });
}
