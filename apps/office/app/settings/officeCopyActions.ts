'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { OFFICE_COPY_SETTING_KEY } from '@thc/notifications';
import { READ_ONLY_MESSAGE } from '../_lib/sessionRole';
import { settingsDb } from './db';
import { supabaseConfigured } from './data';
import { validateOfficeCopy } from './officeCopy';
import type { ActionResult } from './types';

/**
 * ADR-0179: save who gets the office copy of every timesheet sent to a
 * client. The same plain table write as the rest of /settings: RLS makes it
 * owner-only (office_can('settings')), settings_audit records who changed
 * it, and settings_document_office_copy_guard refuses any other shape. An
 * empty box saves `{ "emails": [] }` — the copy is off, the row stays.
 */
export async function saveDocumentOfficeCopy(text: string): Promise<ActionResult> {
  if (typeof text !== 'string') return { ok: false, message: 'Nothing to save.' };
  const checked = validateOfficeCopy(text);
  if (!checked.ok) return checked;
  if (!supabaseConfigured()) {
    return {
      ok: false,
      message:
        'This environment has no Supabase project, so settings cannot be saved. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = settingsDb(await cookies());
  const { error } = await supabase.from('settings').upsert(
    {
      key: OFFICE_COPY_SETTING_KEY,
      value: { emails: checked.emails },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error) {
    if (/\bread_only\b/.test(error.message)) return { ok: false, message: READ_ONLY_MESSAGE };
    // The database's own words name policies and columns: logged, not shown.
    console.error('[settings] document_office_copy failed', {
      code: error.code,
      message: error.message,
    });
    return {
      ok: false,
      message: 'That could not be saved. Try again, or ask an owner if it keeps happening.',
    };
  }
  revalidatePath('/settings');
  return { ok: true };
}
