/* eslint-disable @typescript-eslint/no-explicit-any -- packages/db ships a
   placeholder Database type until `pnpm --filter @thc/db gen:types` runs
   against a linked project, so `from('profiles')` resolves to `never`. Same
   narrowing the other office loaders use, for one row. */

import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';

/** Who the sidebar foot names. Serialisable: it crosses to a client component. */
export interface OfficeUser {
  name: string;
  role?: string;
}

/** True when this environment has a Supabase project wired up (docs/04). */
function supabaseConfigured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  );
}

/**
 * The signed-in operator, read once in the root layout (§9, sidebar foot).
 *
 * This lives apart from `OfficeShell` on purpose. Seven Back Office screens
 * render that shell from a client component — `StaffScreen`, `RolesScreen`,
 * `ClientsScreen`, `ClientCard`, `ProfileScreen`, `OnboardingBoard`,
 * `CandidateScreen`, `SettingsScreen` — and a `next/headers` import anywhere
 * in the shell's graph fails their build. The layout is a server component,
 * so it can read this and hand the result across the boundary as data.
 *
 * Null rather than a placeholder when there is no project or no session: the
 * foot then shows the sign-out alone, which is honest, where a fake name is
 * not.
 */
export async function officeUser(): Promise<OfficeUser | null> {
  if (!supabaseConfigured()) return null;

  const supabase = createClient(await cookies()) as any;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', auth.user.id)
    .maybeSingle();

  const name = profile?.full_name ?? auth.user.email;
  if (!name) return null;

  // app_metadata, not the profiles row: it is what the middleware gated on
  // to admit this session to this app at all, and the user cannot edit it.
  const role = auth.user.app_metadata?.['role'];
  return { name, ...(role === 'admin' ? { role: 'Admin' } : {}) };
}
