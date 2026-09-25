/* eslint-disable @typescript-eslint/no-explicit-any -- packages/db ships a
   placeholder Database type until `pnpm --filter @thc/db gen:types` runs
   against a linked project, so `from('profiles')` resolves to `never`. Same
   narrowing the other office loaders use, for one row. */

import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { type OfficeRole, OFFICE_ROLE_LABEL, isOfficeRole } from '../_lib/permissions';

/** Who the sidebar foot names. Serialisable: it crosses to a client component. */
export interface OfficeUser {
  name: string;
  /** The line under the name: the office role's label (ADR-0036), or "Admin". */
  role?: string;
  /**
   * `profiles.office_role` — what the menu and the gated pages ask
   * (`_lib/permissions.ts`). Absent when it could not be read; the screens
   * then hide nothing and the database refuses what it must.
   */
  officeRole?: OfficeRole;
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
 *
 * Wrapped in React's `cache`, so the layout and a gated page (Reports,
 * Settings, Users & access…) share one lookup per request.
 */
export const officeUser = cache(async (): Promise<OfficeUser | null> => {
  if (!supabaseConfigured()) return null;

  const supabase = createClient(await cookies()) as any;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, office_role')
    .eq('id', auth.user.id)
    .maybeSingle();

  const name = profile?.full_name ?? auth.user.email;
  if (!name) return null;

  // app_metadata, not the profiles row: it is what the middleware gated on
  // to admit this session to this app at all, and the user cannot edit it.
  const role = auth.user.app_metadata?.['role'];
  if (role !== 'admin') return { name };
  // The office role is read from profiles: it is not in the token, and a
  // change on /users takes effect on the next request, as the database's
  // office_can() does.
  const officeRole: unknown = profile?.office_role;
  return isOfficeRole(officeRole)
    ? { name, role: OFFICE_ROLE_LABEL[officeRole], officeRole }
    : { name, role: 'Admin' };
});

/**
 * The signed-in operator's office role, for a server page's gate. Shares
 * the layout's lookup (`cache`), so it costs no second round trip.
 */
export async function currentOfficeRole(): Promise<OfficeRole | null> {
  return (await officeUser())?.officeRole ?? null;
}
