'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import type { ActionResult } from './types';

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
  rpc(fn: string, args: RpcArguments): PromiseLike<{ error: { message: string } | null }>;
}

async function callRpc(fn: string, args: RpcArguments, clientId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

/**
 * The charge rate is validated here as well as in the database. A third
 * decimal is rejected rather than rounded: `numeric(8,2)` would turn
 * £22.975 into £22.98 silently, and every margin on this screen is
 * derived from the figure.
 */
function invalidRate(rate: number): string | null {
  if (!Number.isFinite(rate)) return 'Enter a charge rate.';
  if (rate < 0) return 'A charge rate cannot be negative.';
  if (Math.round(rate * 100) !== rate * 100) {
    return 'A charge rate is in pounds and pence — two decimal places.';
  }
  return null;
}

export async function addRole(
  clientId: string,
  roleId: string,
  chargeRate: number,
  dressCodes: string[],
): Promise<ActionResult> {
  const invalid = invalidRate(chargeRate);
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
  const invalid = invalidRate(chargeRate);
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
  const failures: string[] = [];

  for (const staffId of staffIds) {
    for (const roleId of roleIds) {
      const { error } = await supabase.rpc('grant_client_qualification', {
        p_staff: staffId,
        p_client: clientId,
        p_role: roleId,
        p_note: note.trim() || null,
      });
      if (error) failures.push(error.message);
    }
  }

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
