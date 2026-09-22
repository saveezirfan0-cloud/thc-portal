import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import type { Client } from '../types';
import type {
  ClientCardData,
  ClientEventRow,
  QualifiedStaffRow,
  RateCardRow,
  RoleOption,
  StaffOption,
} from './types';

/**
 * Reads for /clients/:id (§9.7).
 *
 * `roles` and `staff` are the two "+ Add" pickers. The role list is the
 * whole §9.8 catalogue, not the client's own rate card: §9.7 says a role
 * missing from the dropdown "must first be created in the Roles section",
 * which only makes sense if the dropdown shows the catalogue.
 */
const NOT_CONFIGURED =
  'This environment has no Supabase project, so the client card cannot be read. See docs/04-setup-github-vercel-supabase.md.';

const EMPTY: Omit<ClientCardData, 'problem'> = {
  client: null,
  rateCard: [],
  qualified: [],
  events: [],
  roles: [],
  staff: [],
};

const CLIENT_COLUMNS =
  'id, name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, ' +
  'pays_buffer, rate_card_roles, rate_card_count, event_count, avg_margin_pct';

export async function loadClientCard(id: string): Promise<ClientCardData> {
  if (!supabaseConfigured()) return { ...EMPTY, problem: NOT_CONFIGURED };

  const supabase = createClient(await cookies());

  const [client, rateCard, qualified, events, roles, staff] = await Promise.all([
    supabase.from('clients_directory_v').select(CLIENT_COLUMNS).eq('id', id).maybeSingle<Client>(),
    supabase
      .from('clients_rate_card_v')
      .select('*')
      .eq('client_id', id)
      .order('role_name')
      .returns<RateCardRow[]>(),
    supabase
      .from('clients_qualified_staff_v')
      .select('*')
      .eq('client_id', id)
      .order('display_name')
      .returns<QualifiedStaffRow[]>(),
    supabase
      .from('clients_event_list_v')
      .select('*')
      .eq('client_id', id)
      .order('event_date', { ascending: false })
      .returns<ClientEventRow[]>(),
    supabase.from('roles').select('id, name, pay_rate').order('name').returns<RoleOption[]>(),
    supabase
      .from('staff_directory_v')
      .select('id, display_name, employee_id, role_names')
      .eq('status', 'compliant')
      .order('display_name')
      .returns<StaffOption[]>(),
  ]);

  const error =
    client.error ?? rateCard.error ?? qualified.error ?? events.error ?? roles.error ?? staff.error;
  if (error) return { ...EMPTY, problem: error.message };

  return {
    client: client.data ?? null,
    rateCard: rateCard.data ?? [],
    qualified: qualified.data ?? [],
    events: events.data ?? [],
    roles: roles.data ?? [],
    staff: staff.data ?? [],
    problem: null,
  };
}
