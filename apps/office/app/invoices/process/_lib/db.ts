/* eslint-disable @typescript-eslint/no-explicit-any -- packages/db ships a
   placeholder Database type until `pnpm --filter @thc/db gen:types` runs
   against a linked project, so the ADR-0210 tables resolve to `never`. Every
   row is mapped to a typed shape in data.ts / actions.ts straight away. */

import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  );
}

/** The signed-in person's client: RLS decides (finance owners / managers write). */
export async function officeDb(): Promise<any> {
  return createClient(await cookies()) as any;
}

/** Service role — storage only (private `timesheets` bucket). Never for rows. */
export function storageAdmin(): any {
  return createAdminClient() as any;
}

export const BUCKET = 'timesheets';
