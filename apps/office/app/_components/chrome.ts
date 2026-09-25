import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { isRole } from '@thc/db';
import { EMPTY_CHROME } from './ChromeContext';
import type { ChromeData } from './ChromeContext';

/**
 * The chrome's own read, once per request from the root layout (§4.1's menu
 * counter, the sidebar foot's operator). Server-side only: this file pulls
 * `next/headers` and the cookie-backed client, which is exactly what
 * `OfficeShell` must not import — the shell reaches the result through
 * `ChromeProvider` instead.
 *
 * Nothing here decides access. The identity comes from the session's JWT,
 * which the middleware has already verified on this same request and which
 * `getClaims()` verifies again against the project's signing keys; the count
 * comes from a security_invoker view whose only cross-worker policy is
 * admin's, so a session that is not the office's counts nothing and a
 * missing one costs nothing (no query without claims).
 *
 * A failed read is a blank badge, never a broken page: the sidebar is on
 * every screen and a chrome that throws takes the whole app down with it.
 */
export async function loadChrome(): Promise<ChromeData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return EMPTY_CHROME;
  }
  try {
    const supabase = createClient(await cookies());
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims) return EMPTY_CHROME;

    const role = claims.app_metadata?.['role'];
    const user = {
      name: operatorName(claims.user_metadata?.['full_name'], claims.email),
      ...(isRole(role) ? { role: ROLE_LABEL[role] } : {}),
    };

    // Not the office's session: the view would come back empty anyway, so
    // skip the round trip and show the foot alone (the middleware has
    // already answered a wrong-app request; this is belt and braces).
    if (role !== 'admin') return { complianceCount: 0, user };

    const { count, error } = await supabase
      .from('compliance_review_queue_v')
      .select('item_id', { count: 'exact', head: true });
    return { complianceCount: error ? 0 : (count ?? 0), user };
  } catch {
    return EMPTY_CHROME;
  }
}

const ROLE_LABEL = { admin: 'Admin', client: 'Client', staff: 'Staff' } as const;

/**
 * The seed and the invite flow put the display name in
 * `user_metadata.full_name` ("Gisela M."). An account created some other way
 * has only its email; the local part is still a name the operator will
 * recognise as their own, where a blank foot reads as signed out.
 */
export function operatorName(fullName: unknown, email: unknown): string {
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();
  if (typeof email === 'string' && email.includes('@')) return email.slice(0, email.indexOf('@'));
  return 'Signed in';
}
