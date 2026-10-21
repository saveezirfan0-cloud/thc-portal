import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from '../db';
import { parseDeclarationUpdate } from './declarationUpdate';
import type { DeclarationUpdate } from './declarationUpdate';

/**
 * `my_declaration_update()` on its own (ADR-0180), for the screens that do
 * not read the whole Documents tab — the paused onboarding screen.
 */
/** Null when there is nothing to read, or the read failed: the screens then offer nothing. */
export async function loadDeclarationUpdate(): Promise<DeclarationUpdate | null> {
  if (!supabaseConfigured()) return null;
  try {
    const { data, error } = await staffDb(await cookies()).rpc('my_declaration_update');
    if (error) return null;
    return parseDeclarationUpdate(data);
  } catch {
    return null;
  }
}
