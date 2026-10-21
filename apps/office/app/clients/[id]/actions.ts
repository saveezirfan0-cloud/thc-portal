'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { type DbError, explainDbError } from '../../_lib/dbError';
import { BULK_CONCURRENCY, mapPool } from '../../_lib/pool';
import { supabaseConfigured } from '../data';
import { PICKER_PAGE, chargeRateProblem, pickerSearch } from './card';
import {
  invoiceDetailsProblem,
  invoiceEmailsProblem,
  normaliseInvoiceEmails,
} from './invoiceDetails';
import type { ActionResult, PickerPage, StaffOption } from './types';

/**
 * Writes for /clients/:id (§9.7).
 *
 * All of these are `security invoker` RPCs, so RLS is the gate — unlike
 * the profile's four manager buttons, none of this cascades or is
 * irreversible, so none of it needs the service role.
 *
 * There is no delete action for the client itself, and no function behind
 * one: §9.7 says a client record can only ever be edited, and
 * 280_clients_directory.sql asserts `delete_client` does not exist.
 * `removeRole` below drops a row from the RATE CARD, which is a different
 * thing and leaves every built event alone.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

type RpcArguments = Record<string, string | number | boolean | string[] | null>;

interface RpcClient {
  rpc(fn: string, args: RpcArguments): PromiseLike<{ error: DbError | null }>;
}

/**
 * Release audit D-M5: the database's words, as a sentence (`_lib/dbError`).
 * The functions behind this card raise their own sentences for the rules
 * (a reason for Do not return, a role the worker does not hold) — those
 * are kept; what is mapped here is the codes and Postgres's templates.
 */
const CARD_WORDING = {
  unique: 'That role is already on this client’s rate card. Edit its row instead.',
  foreignKey: 'That role or worker no longer exists. Refresh the page.',
  codes: {
    unknown_client: 'That client no longer exists. Refresh the page.',
    unknown_rate_card_row: 'That rate card row no longer exists. Refresh the page.',
    unknown_qualification: 'That qualification no longer exists. Refresh the page.',
    quiz_not_found: 'That quiz no longer exists. Refresh the page.',
    unknown_worker_request: 'That request no longer exists. Refresh the page.',
    client_has_upcoming_events:
      'This client still has an event today or later. Finish or cancel those first, then archive it.',
  },
  log: '[client card]',
};

async function callRpc(fn: string, args: RpcArguments, clientId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: explainDbError(error, CARD_WORDING) };

  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

export async function addRole(
  clientId: string,
  roleId: string,
  chargeRate: number,
  dressCodes: string[],
): Promise<ActionResult> {
  // Validated here as well as in the database (assert_charge_rate).
  const invalid = chargeRateProblem(chargeRate);
  if (invalid) return { ok: false, message: invalid };

  return callRpc(
    'add_client_role',
    { p_client: clientId, p_role: roleId, p_charge_rate: chargeRate, p_dress_codes: dressCodes },
    clientId,
  );
}

export async function updateRole(
  clientId: string,
  id: string,
  chargeRate: number,
  dressCodes: string[],
): Promise<ActionResult> {
  // Validated here as well as in the database (assert_charge_rate).
  const invalid = chargeRateProblem(chargeRate);
  if (invalid) return { ok: false, message: invalid };

  return callRpc(
    'update_client_role',
    { p_id: id, p_charge_rate: chargeRate, p_dress_codes: dressCodes },
    clientId,
  );
}

/**
 * Drops a role from the rate card. Events already built keep the charge
 * rate, pay rate and dress code they were built with (§3.2), so this only
 * changes what the next event for this client can be built from.
 */
export async function removeRole(clientId: string, id: string): Promise<ActionResult> {
  return callRpc('remove_client_role', { p_id: id }, clientId);
}

/**
 * §9.7's "+ Add staff", which is §9.6's grant seen from the client's end —
 * the same function, so the two screens cannot drift. One call per
 * client + role pair, because that is what a qualification IS: clearing
 * somebody as Waiting Staff here says nothing about Bar Staff here.
 */
export async function qualifyStaff(
  clientId: string,
  staffIds: string[],
  roleIds: string[],
  note: string,
): Promise<ActionResult> {
  if (staffIds.length === 0) return { ok: false, message: 'Choose at least one worker.' };
  if (roleIds.length === 0) return { ok: false, message: 'Choose at least one role.' };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  // Each pair is still its own call, refused or granted on its own — eight
  // at a time rather than one after another (go-live audit M5): twelve
  // workers × three roles is 36 round trips.
  const pairs = staffIds.flatMap((staffId) => roleIds.map((roleId) => ({ staffId, roleId })));
  const replies = await mapPool(pairs, BULK_CONCURRENCY, async ({ staffId, roleId }) =>
    supabase.rpc('grant_client_qualification', {
      p_staff: staffId,
      p_client: clientId,
      p_role: roleId,
      p_note: note.trim() || null,
    }),
  );
  const failures = replies.flatMap((reply) =>
    reply?.error ? [explainDbError(reply.error, CARD_WORDING)] : [],
  );

  revalidatePath(`/clients/${clientId}`);
  // Partial success is reported rather than swallowed: a worker who does
  // not hold the role is refused by the database (§9.6), and a manager who
  // bulk-added twelve people needs to know which two did not take.
  if (failures.length > 0) {
    return { ok: false, message: [...new Set(failures)].join(' · ') };
  }
  return { ok: true };
}

export async function revokeQualification(clientId: string, id: string): Promise<ActionResult> {
  return callRpc('revoke_client_qualification', { p_id: id }, clientId);
}

export async function setDoNotReturn(
  clientId: string,
  id: string,
  on: boolean,
  reason: string,
): Promise<ActionResult> {
  if (on && reason.trim() === '') {
    return { ok: false, message: 'Do not return needs a reason.' };
  }
  return callRpc(
    'set_do_not_return',
    { p_id: id, p_on: on, p_reason: reason.trim() || null },
    clientId,
  );
}

/**
 * ADR-0081: the Name badges switch. The database refuses a viewer
 * (ADR-0060) and writes the change to the client's History.
 */
export async function setNameBadges(clientId: string, on: boolean): Promise<ActionResult> {
  return callRpc('set_client_name_badges', { p_client: clientId, p_on: on }, clientId);
}

/**
 * ADR-0185: archive a client so it stops showing as active. Nothing is
 * removed; the database refuses while an event today or later is not
 * cancelled, and writes the change to the client's History.
 */
export async function archiveClient(clientId: string): Promise<ActionResult> {
  return callRpc('archive_client', { p_client: clientId }, clientId);
}

/** ADR-0185: bring an archived client back to the active list. */
export async function restoreClient(clientId: string): Promise<ActionResult> {
  return callRpc('restore_client', { p_client: clientId }, clientId);
}

/** ADR-0135 §3: one of the two line-up emails to this client, on or off (audited). */
export async function setLineupEmails(
  clientId: string,
  kind: 'confirmed' | 'changed',
  on: boolean,
): Promise<ActionResult> {
  return callRpc(
    'set_client_lineup_emails',
    { p_client: clientId, p_kind: kind, p_on: on },
    clientId,
  );
}

/**
 * ADR-0176: the Invoicing panel — who the invoice is addressed to, where it
 * is emailed (up to five; none sends it to the contact emails) and the
 * billing address printed under "Invoice to". The database normalises and
 * validates the addresses and audits the change; the same rules are said
 * here first so a typo costs no round trip.
 */
export async function setInvoiceDetails(
  clientId: string,
  details: {
    accountsContactName: string;
    invoiceEmails: string[];
    invoiceCcEmails: string[];
    billingAddress: string;
  },
): Promise<ActionResult> {
  const emails = normaliseInvoiceEmails(details.invoiceEmails ?? []);
  const cc = normaliseInvoiceEmails(details.invoiceCcEmails ?? []);
  const invalid = invoiceEmailsProblem(emails) ?? invoiceEmailsProblem(cc, 'CC emails');
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc('set_client_invoice_details', {
    p_client: clientId,
    p_contact_name: String(details.accountsContactName ?? '').trim() || null,
    p_emails: emails,
    p_address: String(details.billingAddress ?? '').trim() || null,
    // An address in both lists goes To; the database drops it from CC.
    p_cc_emails: cc.filter((email) => !emails.includes(email)),
  });
  if (error) return { ok: false, message: invoiceDetailsProblem(error) };

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

/** ADR-0135 §2: a Client Portal "Request again" is dealt with (audited). */
export async function markRequestHandled(clientId: string, id: string): Promise<ActionResult> {
  return callRpc('mark_client_worker_request_handled', { p_id: id }, clientId);
}

/**
 * ADR-0110: give a worker their attempts at this client's quiz back. The
 * attempts stay as history, superseded; the worker is asked again from
 * their next shift on a role that names the quiz.
 */
export async function resetQuizAttempts(
  clientId: string,
  quizId: string,
  staffId: string,
): Promise<ActionResult> {
  return callRpc('reset_client_quiz_attempts', { p_quiz: quizId, p_staff: staffId }, clientId);
}

/** The picker's reads, typed narrowly: `staff`, `staff_roles` and `roles` by name. */
interface PickerQuery<T> extends PromiseLike<{
  data: T[] | null;
  error: DbError | null;
  count?: number | null;
}> {
  eq(column: string, value: string | number): PickerQuery<T>;
  is(column: string, value: null): PickerQuery<T>;
  or(filters: string): PickerQuery<T>;
  in(column: string, values: readonly string[]): PickerQuery<T>;
  order(column: string): PickerQuery<T>;
  range(from: number, to: number): PickerQuery<T>;
}
interface PickerClient {
  from(table: 'staff'): {
    select(
      columns: string,
      options: { count: 'exact' },
    ): PickerQuery<{
      id: string;
      first_name: string;
      last_name: string;
      employee_id: number | null;
    }>;
  };
  from(table: 'staff_roles'): {
    select(columns: string): PickerQuery<{ staff_id: string; role_id: string }>;
  };
  from(table: 'roles'): { select(columns: string): PickerQuery<{ id: string; name: string }> };
}

/**
 * "+ Add staff" (§9.7): one page of the compliant workers whose first or
 * last name holds every word typed, or whose Employee ID it is — with the
 * roles each holds, so the dialog can grey out who cannot take the chosen
 * role. Read off `staff` and `staff_roles` (admin_all / admin_read), a
 * narrow indexed read, instead of the whole `staff_directory_v` — which
 * computed the weekly cap for all ~1,000 workers to fill a name list, and
 * was cut at 1,000 by name (go-live audit M2). A removed worker is never
 * offered (§1.7). `total` is the server's exact count, for "Showing N of M".
 */
export async function searchQualifyPicker(query: string, offset = 0): Promise<PickerPage> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as PickerClient;
  const { words, employeeId } = pickerSearch(String(query ?? ''));
  const from = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;

  let read = supabase
    .from('staff')
    .select('id, first_name, last_name, employee_id', { count: 'exact' })
    .eq('status', 'compliant')
    .is('removed_at', null);
  if (employeeId !== null) read = read.eq('employee_id', employeeId);
  // `*` is PostgREST's ilike wildcard; pickerSearch has already dropped every
  // character its filter syntax reserves.
  for (const word of words) read = read.or(`first_name.ilike.*${word}*,last_name.ilike.*${word}*`);
  const page = await read
    .order('first_name')
    .order('last_name')
    .order('id')
    .range(from, from + PICKER_PAGE - 1);
  if (page.error) return { ok: false, message: explainDbError(page.error, CARD_WORDING) };

  const rows = page.data ?? [];
  const ids = rows.map((row) => row.id);
  const [held, roles] = ids.length
    ? await Promise.all([
        supabase.from('staff_roles').select('staff_id, role_id').in('staff_id', ids),
        supabase.from('roles').select('id, name'),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  const failed = held.error ?? roles.error;
  if (failed) return { ok: false, message: explainDbError(failed, CARD_WORDING) };

  const roleName = new Map((roles.data ?? []).map((role) => [role.id, role.name]));
  const rolesOf = new Map<string, string[]>();
  for (const { staff_id, role_id } of held.data ?? []) {
    const list = rolesOf.get(staff_id) ?? [];
    list.push(roleName.get(role_id) ?? 'Role');
    rolesOf.set(staff_id, list);
  }
  const workers: StaffOption[] = rows.map((row) => ({
    id: row.id,
    display_name: `${row.first_name} ${row.last_name}`,
    employee_id: row.employee_id,
    role_names: (rolesOf.get(row.id) ?? []).sort(),
  }));
  return { ok: true, workers, total: page.count ?? from + workers.length };
}
