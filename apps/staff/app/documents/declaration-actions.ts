'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { CONVICTION_DETAILS_MAX, UPDATE_DECLARATION_REASONS } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../db';
import type { ActionResult } from './types';

/**
 * Update your declaration (ADR-0180) — `update_my_declaration()`, which
 * takes no staff id: the database resolves the worker from their session,
 * checks they may (the office asked for more details, or rejected their
 * Yes; never a manual hold), adds a NEW declaration and supersedes the old
 * one, which is never edited. A compliant worker is paused for the review
 * there and then, as any declaration from the app pauses them (§10.7).
 */
const NOT_CONFIGURED =
  'This environment has no Supabase project, so nothing can be saved. See docs/04-setup-github-vercel-supabase.md.';
const TRY_AGAIN = 'That did not go through. Please try again.';

export async function updateDeclaration(
  details: string,
  convictionDate: string | null,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const text = details.trim();
  if (!text) return { ok: false, message: UPDATE_DECLARATION_REASONS['details_required']! };
  if (text.length > CONVICTION_DETAILS_MAX) {
    return { ok: false, message: UPDATE_DECLARATION_REASONS['details_too_long']! };
  }
  const date = convictionDate && /^\d{4}-\d{2}-\d{2}$/.test(convictionDate) ? convictionDate : null;
  const { data, error } = await staffDb(await cookies()).rpc('update_my_declaration', {
    p_details: text,
    p_conviction_date: date,
  });
  const answer = (data ?? null) as { ok?: boolean; reason?: string } | null;
  if (error || !answer?.ok) {
    const code = answer?.reason ?? error?.message ?? '';
    const known = Object.keys(UPDATE_DECLARATION_REASONS).find(
      (key) => code === key || code.includes(key),
    );
    if (!known) console.error('[documents] unmapped declaration refusal', { message: code });
    return { ok: false, message: known ? UPDATE_DECLARATION_REASONS[known]! : TRY_AGAIN };
  }
  // A compliant worker has just been paused: every cached screen goes.
  revalidatePath('/', 'layout');
  return { ok: true };
}
