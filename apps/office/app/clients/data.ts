import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readAllPages } from '@thc/db/paged';
import type { Client } from './types';
import { readProblem } from '../_lib/dbError';

/**
 * Reads for /clients (§9.7).
 *
 * `client_rate_cards` carries `charge_rate`, so this whole surface is
 * money: `clients` and the rate cards are admin-only, and
 * `clients_directory_v` is security_invoker, so §11.1 holds without the
 * screen doing anything.
 */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface ClientsPageData {
  clients: Client[];
  problem: string | null;
}

export async function loadClients(): Promise<ClientsPageData> {
  if (!supabaseConfigured()) {
    return {
      clients: [],
      problem:
        'This environment has no Supabase project, so the client directory cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = createClient(await cookies());
  // Paged by (name, id): PostgREST stops at 1000 rows without an error, and
  // whoever sorted last would vanish from the directory and its search.
  const { data, error } = await readAllPages<Client>(
    (range) =>
      supabase
        .from('clients_directory_v')
        .select(
          'id, name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, pays_buffer, rate_card_roles, rate_card_count, event_count, avg_margin_pct, created_at, created_by, created_by_name',
        )
        .order('name')
        .order('id')
        .range(range.from, range.to)
        .returns<Client[]>(),
    { what: 'clients', key: (row) => row.id },
  );

  if (error) return { clients: [], problem: readProblem(error) };
  return { clients: data ?? [], problem: null };
}
