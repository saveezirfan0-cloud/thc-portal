/* eslint-disable @typescript-eslint/no-explicit-any -- client_account_v is
   newer than packages/db's generated types; regenerating them is
   `pnpm --filter @thc/db gen:types` against a live project after the
   migration deploys. The shape is asserted by
   supabase/tests/606_client_account_view.sql against the real schema. */

import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import type { AccountDetails } from './AccountScreen';
import { ACCOUNT_COPY } from './copy';

/**
 * The reads behind "Your account" (ADR-0051), under the caller's own session:
 *
 *   · the name from their own `profiles` row (profiles_self);
 *   · the sign-in email from auth.getUser();
 *   · the company and the document recipients from `client_account_v`,
 *     NOT from `clients` — the client role holds no policy on that table
 *     and must not be given one (ADR-0004, ADR-0026). The view returns the
 *     caller's own row only; there is deliberately no `where` here, so the
 *     tenancy rule lives in the database and nowhere this file could drop.
 */
const EMPTY: AccountDetails = { name: null, email: null, company: null, recipients: [] };

export async function loadAccount(): Promise<{ account: AccountDetails; problem: string | null }> {
  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return { account: EMPTY, problem: ACCOUNT_COPY.noProject };
  }

  const supabase = createClient(await cookies()) as any;
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  // The middleware sends a signed-out visitor to /login before this runs.
  if (!user) return { account: EMPTY, problem: ACCOUNT_COPY.loadFailed };

  const [profile, company] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    supabase.from('client_account_v').select('name, contact_emails').maybeSingle(),
  ]);

  const failed = Boolean(profile.error || company.error);
  if (failed) {
    console.error('[account] load failed', {
      profile: profile.error?.message,
      account: company.error?.message,
    });
  }

  const recipients: unknown = company.data?.contact_emails;
  return {
    account: {
      name: profile.data?.full_name ?? null,
      email: user.email ?? null,
      company: company.data?.name ?? null,
      recipients: Array.isArray(recipients)
        ? recipients.filter((r): r is string => typeof r === 'string')
        : [],
    },
    problem: failed ? ACCOUNT_COPY.loadFailed : null,
  };
}
