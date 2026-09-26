/**
 * Is the caller a Back Office login, as the DATABASE sees them right now?
 *
 * Asked through `current_app_role()` rather than by reading `profiles`,
 * because since 20260930210500 that function also refuses a switched-off
 * login and a two-step login below aal2. A server action that reaches for
 * the service key must ask it: the service key does not meet RLS, so this
 * check is the whole gate (security review of ADR-0049…0039).
 */
interface RoleRpc {
  rpc(fn: 'current_app_role'): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function sessionIsAdmin(supabase: unknown): Promise<boolean> {
  const { data, error } = await (supabase as RoleRpc).rpc('current_app_role');
  return !error && data === 'admin';
}
