/**
 * Is the caller a Back Office login, as the DATABASE sees them right now?
 *
 * Asked through `current_app_role()` rather than by reading `profiles`,
 * because since 20261001200500 that function also refuses a switched-off
 * login and a two-step login below aal2. A server action that reaches for
 * the service key must ask it: the service key does not meet RLS, so this
 * check is the whole gate (security review of ADR-0055…0039).
 */
interface RoleRpc {
  rpc(fn: 'current_app_role'): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function sessionIsAdmin(supabase: unknown): Promise<boolean> {
  const { data, error } = await (supabase as RoleRpc).rpc('current_app_role');
  return !error && data === 'admin';
}

interface CanRpc {
  rpc(
    fn: 'office_can',
    args: { p_perm: 'write' },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * May the caller CHANGE anything in the Back Office, as the database sees
 * them right now (ADR-0060)? `office_can('write')` (latest definition
 * 20261001210000): true for an owner, a manager or a scheduler, false for a
 * viewer — and false for anyone `current_app_role()` does not answer
 * 'admin' for, so a switched-off login or a two-step login below aal2 is
 * refused too. It therefore implies `sessionIsAdmin`.
 *
 * Ask it before every side effect the database cannot take back on a
 * viewer's behalf: a service-key call (a GoTrue user, a signed upload slot,
 * a Storage write or delete) runs outside the `office_read_only` triggers,
 * so without this a viewer's request leaves its mark before the RPC that
 * follows refuses them. Anything but an explicit `true` is a no.
 */
export async function officeMayWrite(supabase: unknown): Promise<boolean> {
  const { data, error } = await (supabase as CanRpc).rpc('office_can', { p_perm: 'write' });
  return !error && data === true;
}

/** The refusal a read-only login (ADR-0060) is shown, as the database's `read_only` reads elsewhere. */
export const READ_ONLY_MESSAGE = 'Your login is read-only, so this cannot be changed.';
