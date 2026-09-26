'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import { validateDecision } from '@thc/domain';
import { supabaseConfigured } from '../data';
import { decisionMessage } from './model';
import type { DecisionResult } from './types';

/**
 * The office's decision on a name/photo change request — ADR-0044.
 *
 * `office_decide_profile_change` is a definer with the admin check in its
 * own body and `auth.uid()` as the decider, so it is called through the
 * manager's SESSION, never the service key: the audit row and
 * `decided_by` then name the manager without anything being passed in.
 *
 * The evidence tick is asked again here. The database cannot see it, and a
 * confirmation that exists only in the browser is not one (the Remove
 * pattern in ../[id]/actions.ts): a name is approved only with it, and the
 * kind is read from the request itself, never taken from the browser.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

interface DecideRpc {
  rpc(
    fn: 'office_decide_profile_change',
    args: { p_id: string; p_approve: boolean; p_reason: string | null },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

interface RequestRead {
  from(table: 'profile_change_requests'): {
    select(columns: 'kind, staff_id, evidence_path'): {
      eq(
        column: 'id',
        value: string,
      ): {
        maybeSingle<T>(): PromiseLike<{ data: T | null; error: { message: string } | null }>;
      };
    };
  };
}

type RequestFacts = { kind: 'name' | 'photo'; staff_id: string; evidence_path: string | null };

async function readRequest(
  supabase: ReturnType<typeof createClient>,
  id: string,
): Promise<{ ok: true; facts: RequestFacts } | { ok: false; message: string }> {
  const { data, error } = await (supabase as unknown as RequestRead)
    .from('profile_change_requests')
    .select('kind, staff_id, evidence_path')
    .eq('id', id)
    .maybeSingle<RequestFacts>();
  if (error) return { ok: false, message: error.message };
  // admin_read is the only policy: a session that is not the office's reads
  // no row, which is exactly "not found" from where it stands.
  if (!data) return { ok: false, message: decisionMessage('request_not_found') };
  return { ok: true, facts: data };
}

export async function decideChangeRequest(
  id: string,
  approve: boolean,
  reason: string,
  evidenceChecked: boolean,
): Promise<DecisionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const refusal = validateDecision(approve, reason);
  if (refusal) return { ok: false, message: decisionMessage(refusal) };

  const supabase = createClient(await cookies());
  const request = await readRequest(supabase, id);
  if (!request.ok) return request;
  if (approve && request.facts.kind === 'name' && !evidenceChecked) {
    return { ok: false, message: decisionMessage('evidence_unchecked') };
  }

  const { error } = await (supabase as unknown as DecideRpc).rpc('office_decide_profile_change', {
    p_id: id,
    p_approve: approve,
    // An approval stores no reason; a rejection's is shown to the worker.
    p_reason: approve ? null : reason.trim(),
  });
  if (error) return { ok: false, message: decisionMessage(error.message) };

  revalidatePath('/staff/requests');
  revalidatePath('/staff');
  revalidatePath(`/staff/${request.facts.staff_id}`);
  return { ok: true };
}

/**
 * A short-lived link to a name change's evidence, in the private
 * `documents` bucket. The path is read through the SESSION first (admin_read
 * decides whether this manager may see the request), so what is signed is
 * never a path the browser supplied; the signing itself needs the service
 * key, as /onboarding's documentLink does.
 */
export async function changeEvidenceLink(id: string): Promise<DecisionResult & { url?: string }> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = createClient(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: 'Sign in to do this.' };

  const request = await readRequest(supabase, id);
  if (!request.ok) return request;
  const path = request.facts.evidence_path;
  if (!path) return { ok: false, message: 'There is no evidence file on this request.' };

  const { data: signed, error } = await createAdminClient()
    .storage.from('documents')
    .createSignedUrl(path, 60);
  if (error || !signed) return { ok: false, message: error?.message ?? 'Could not open the file.' };
  return { ok: true, url: signed.signedUrl };
}
