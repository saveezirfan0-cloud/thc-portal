import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';

/**
 * Who may connect, disconnect or sync Xero from the Back Office: asked of the
 * DATABASE (office_can), not the cookie, because the routes then use the
 * service role, which meets no RLS. Connecting is an owner's decision (the
 * same gate as /settings, ADR-0056); moving money data needs finance and
 * write too (ADR-0060: a read-only viewer writes nothing).
 */
interface Rpc {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> };
}

/** A state-changing POST must come from this app's own pages (CSRF, on top of SameSite). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return (
      new URL(origin).host ===
      (request.headers.get('x-forwarded-host') ?? new URL(request.url).host)
    );
  } catch {
    return false;
  }
}

export type XeroOperator = { ok: true; userId: string } | { ok: false; status: 401 | 403 };

export async function xeroOperator(need: 'owner' | 'finance'): Promise<XeroOperator> {
  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return { ok: false, status: 401 };
  }
  const supabase = createClient(await cookies()) as unknown as Rpc;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, status: 401 };
  const perms = need === 'owner' ? ['settings', 'finance', 'write'] : ['finance', 'write'];
  for (const perm of perms) {
    const answer = await supabase.rpc('office_can', { p_perm: perm });
    if (answer.error || answer.data !== true) return { ok: false, status: 403 };
  }
  return { ok: true, userId: data.user.id };
}
