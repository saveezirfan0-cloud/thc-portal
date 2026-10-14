import 'server-only';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';

/**
 * The address of the session holding this request, or null when signed out
 * (or no Supabase project). A1 and A2 are public screens that are ALSO
 * reached from inside the app — "Forgot password?" beside every Current
 * password field (ADR-0113) — and draw a way back to it only then.
 */
export async function signedInEmail(): Promise<string | null> {
  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return null;
  }
  const {
    data: { user },
  } = await createClient(await cookies()).auth.getUser();
  return user?.email ?? null;
}
