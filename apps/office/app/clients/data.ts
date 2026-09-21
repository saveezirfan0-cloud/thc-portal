import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import type { Client } from './types';

/**
 * Reads for /clients (§9.7).
 *
 * `client_rate_cards` carries `charge_rate`, so this whole surface is
 * money: `clients` and the rate cards are admin-only, and
 * `client_directory_v` is security_invoker, so §11.1 holds without the
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
  const { data, error } = await supabase
    .from('client_directory_v')
    .select(
      'id, name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, pays_buffer, rate_card_roles, rate_card_count, event_count, avg_margin_pct',
    )
    .order('name')
    .returns<Client[]>();

  if (error) return { clients: [], problem: error.message };
  return { clients: data ?? [], problem: null };
}
