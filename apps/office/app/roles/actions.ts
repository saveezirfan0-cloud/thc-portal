'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from './data';
import { validateRole } from './validate';
import type { ActionResult, RoleDraft } from './types';

/**
 * Writes for /roles (§9.8), through the RPCs in
 * 20260921153000_roles_directory.sql. RLS is the gate: they are security
 * invoker, so a caller who is not an admin is refused by the policy on
 * `roles`, not by a role test written here.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so roles cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

/**
 * `packages/db`'s generated types are still the Phase 0 placeholder, whose
 * `Functions` map is empty, so supabase-js types every RPC's arguments as
 * `undefined`. Regenerating (`pnpm --filter @thc/db gen:types`) removes this.
 */
type RpcArguments = Record<string, string | number | null>;

interface RpcClient {
  rpc(fn: string, args: RpcArguments): PromiseLike<{ error: { message: string } | null }>;
}

async function callRpc(fn: string, args: RpcArguments): Promise<ActionResult> {
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };

  revalidatePath('/roles');
  return { ok: true };
}

/** Pence on the screen, pounds in `numeric(8,2)`. Converted once, here. */
function pounds(pence: number): number {
  return Number((pence / 100).toFixed(2));
}

export async function createRole(draft: RoleDraft): Promise<ActionResult> {
  const invalid = validateRole(draft);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  return callRpc('create_role', {
    p_name: draft.name.trim(),
    p_pay_rate: pounds(draft.pay_rate_pence),
    p_description: draft.description.trim() || null,
  });
}

export async function updateRole(id: string, draft: RoleDraft): Promise<ActionResult> {
  const invalid = validateRole(draft);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  return callRpc('update_role', {
    p_id: id,
    p_name: draft.name.trim(),
    p_pay_rate: pounds(draft.pay_rate_pence),
    p_description: draft.description.trim() || null,
  });
}

/**
 * §9.8's Delete. `delete_role` refuses while any rate card or any built role
 * section still uses the role, and its message names both counts — the
 * manager is told what to clear rather than shown a constraint name.
 */
export async function deleteRole(id: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  return callRpc('delete_role', { p_id: id });
}
