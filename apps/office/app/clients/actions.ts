'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { type DbError, explainDbError } from '../_lib/dbError';
import { supabaseConfigured } from './data';
import { normaliseInvoiceEmails, validateClient } from './validate';
import type { ActionResult, ClientDraft } from './types';

/**
 * Writes for /clients (§9.7), through the RPCs in
 * 20260922091447_clients_directory.sql.
 *
 * There is no delete action, and there is no delete function behind one:
 * §9.7 says a client record cannot be removed from the system, only
 * edited, and `280_clients_directory.sql` asserts the function's absence.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so clients cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

/** See the note in the roles actions: the generated types are a placeholder. */
type RpcArguments = Record<string, string | number | boolean | string[] | null>;

interface RpcClient {
  rpc(fn: string, args: RpcArguments): PromiseLike<{ error: DbError | null }>;
}

/** Release audit D-M5: the database's words, as a sentence (`_lib/dbError`). */
const CLIENT_WORDING = {
  unique: 'A client with that name already exists.',
  codes: {
    unknown_client: 'That client no longer exists. Refresh the page.',
    invoice_email_required:
      'Add at least one invoice email: the invoice and the sign-in and sign-out log go to these.',
    too_many_invoice_emails: 'Up to 10 invoice emails.',
    invalid_invoice_email:
      'One of the invoice emails is not an email address. Check them and save again.',
    invoice_details_too_long:
      'The accounts contact is at most 200 characters and the billing address at most 1,000.',
  },
  log: '[clients]',
};

async function callRpc(fn: string, args: RpcArguments): Promise<ActionResult> {
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: explainDbError(error, CLIENT_WORDING) };

  revalidatePath('/clients');
  // The Edit dialog is opened from the client card too (§9.7), so the
  // card's own route has to be revalidated or it keeps showing the name
  // and policies the manager has just changed.
  revalidatePath('/clients/[id]', 'page');
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
  const invalid = validateClient(draft, true);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  // ADR-0176 (THC 21.10.2026): a new client is created with where its
  // invoices go; create_client refuses one with no invoice email.
  const invoicing = draft.invoicing!;
  return callRpc('create_client', {
    ...args(draft),
    p_invoice_emails: normaliseInvoiceEmails(invoicing.invoice_emails),
    p_accounts_contact_name: invoicing.accounts_contact_name.trim() || null,
    p_billing_address: invoicing.billing_address.trim() || null,
  });
}

export async function updateClientRecord(id: string, draft: ClientDraft): Promise<ActionResult> {
  const invalid = validateClient(draft);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  return callRpc('update_client', { p_id: id, ...args(draft) });
}
