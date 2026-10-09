import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import { dressCodeLibrary } from './card';
import { withPhotoUrls } from '../../_lib/photos';
import type { Client } from '../types';
import type {
  ClientCardData,
  ClientEventRow,
  QualifiedStaffRow,
  QuizResultRow,
  RateCardRow,
  RoleOption,
  ShiftRequirementRow,
  StaffOption,
} from './types';

/**
 * Reads for /clients/:id (§9.7).
 *
 * `roles` and `staff` are the two "+ Add" pickers. The role list is the
 * whole §9.8 catalogue, not the client's own rate card: §9.7 says a role
 * missing from the dropdown "must first be created in the Roles section",
 * which only makes sense if the dropdown shows the catalogue.
 *
 * ADR-0061: `ratesVisible` is the viewer's `office_can('finance')`. With
 * it, the rate card is `clients_rate_card_v` and the picker's base pay is
 * `role_rates_v`. Without it (a scheduler) neither returns anything, so
 * the rate card is read from `client_rate_cards` itself — role and dress
 * codes, which scheduling needs — and every money field is null.
 */
const NOT_CONFIGURED =
  'This environment has no Supabase project, so the client card cannot be read. See docs/04-setup-github-vercel-supabase.md.';

const EMPTY: Omit<ClientCardData, 'problem'> = {
  client: null,
  nameBadges: false,
  rateCard: [],
  dressCodeLibrary: [],
  qualified: [],
  requirements: [],
  quizResults: [],
  events: [],
  roles: [],
  staff: [],
};

/**
 * The two ADR-0109 views are newer than the generated types; the loader
 * declares the shape it reads, as /staff/roster does (the migration's
 * pgTAP, 783, holds the columns).
 */
interface RequirementQuery<T> extends PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}> {
  eq(column: string, value: string): RequirementQuery<T>;
  order(column: string): RequirementQuery<T>;
}
interface RequirementsClient {
  from(view: 'clients_shift_requirements_v'): {
    select(columns: '*'): RequirementQuery<ShiftRequirementRow>;
  };
  from(view: 'clients_quiz_results_v'): { select(columns: '*'): RequirementQuery<QuizResultRow> };
}

const CLIENT_COLUMNS =
  'id, name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, ' +
  'pays_buffer, rate_card_roles, rate_card_count, event_count, avg_margin_pct';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
}

/** The rate card without a rate: what an office role without finance reads. */
async function rateCardWithoutRates(
  supabase: ReturnType<typeof createClient>,
  clientId: string,
): Promise<{ data: RateCardRow[] | null; error: { message: string } | null }> {
  const [cards, roles] = await Promise.all([
    supabase.from('client_rate_cards').select('id, role_id, dress_codes').eq('client_id', clientId),
    supabase.from('roles').select('id, name, description').returns<RoleRow[]>(),
  ]);
  const error = cards.error ?? roles.error;
  if (error) return { data: null, error };
  const byId = new Map((roles.data ?? []).map((role) => [role.id, role]));
  const rows: RateCardRow[] = (cards.data ?? []).map((card) => ({
    id: card.id,
    role_id: card.role_id,
    role_name: byId.get(card.role_id)?.name ?? 'Role',
    role_description: byId.get(card.role_id)?.description ?? null,
    charge_rate: null,
    base_pay_rate: null,
    final_pay_rate: null,
    margin_per_hour: null,
    margin_pct: null,
    dress_codes: card.dress_codes ?? [],
    section_count: 0,
  }));
  rows.sort((a, b) => a.role_name.localeCompare(b.role_name));
  return { data: rows, error: null };
}

export async function loadClientCard(
  id: string,
  { ratesVisible = true }: { ratesVisible?: boolean } = {},
): Promise<ClientCardData> {
  if (!supabaseConfigured()) return { ...EMPTY, problem: NOT_CONFIGURED };

  const supabase = createClient(await cookies());
  const requirementsDb = supabase as unknown as RequirementsClient;

  const [
    client,
    badges,
    rateCard,
    library,
    qualified,
    events,
    roles,
    payRates,
    staff,
    requirements,
    quizResults,
  ] = await Promise.all([
    supabase.from('clients_directory_v').select(CLIENT_COLUMNS).eq('id', id).maybeSingle<Client>(),
    // ADR-0081: one switch, read from the table rather than restating the view.
    supabase
      .from('clients')
      .select('name_badges')
      .eq('id', id)
      .maybeSingle<{ name_badges: boolean | null }>(),
    ratesVisible
      ? supabase
          .from('clients_rate_card_v')
          .select('*')
          .eq('client_id', id)
          .order('role_name')
          .returns<RateCardRow[]>()
      : rateCardWithoutRates(supabase, id),
    // Dress codes only, from every client: what the add-a-code box offers so a
    // code already stored is picked, not retyped. No rate or worker data.
    supabase.from('client_rate_cards').select('dress_codes'),
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
    supabase
      .from('roles')
      .select('id, name')
      .order('name')
      .returns<{ id: string; name: string }[]>(),
    // ADR-0061: the catalogue base pay beside each role in the "+ Add" picker.
    ratesVisible
      ? supabase.from('role_rates_v').select('role_id, pay_rate')
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('staff_directory_v')
      .select('id, display_name, employee_id, role_names')
      .eq('status', 'compliant')
      .order('display_name')
      .returns<StaffOption[]>(),
    // ADR-0109: what each role asks, and who has sat the quiz.
    requirementsDb
      .from('clients_shift_requirements_v')
      .select('*')
      .eq('client_id', id)
      .order('role_name'),
    requirementsDb
      .from('clients_quiz_results_v')
      .select('*')
      .eq('client_id', id)
      .order('display_name'),
  ]);

  const error =
    client.error ??
    badges.error ??
    rateCard.error ??
    library.error ??
    qualified.error ??
    events.error ??
    roles.error ??
    payRates.error ??
    staff.error ??
    requirements.error ??
    quizResults.error;
  if (error) return { ...EMPTY, problem: error.message };

  const payOf = new Map(
    ((payRates.data ?? []) as { role_id: string | null; pay_rate: number | null }[]).map((r) => [
      r.role_id,
      r.pay_rate,
    ]),
  );
  const roleOptions: RoleOption[] = (roles.data ?? []).map((role) => ({
    id: role.id,
    name: role.name,
    pay_rate: payOf.get(role.id) ?? null,
  }));

  return {
    client: client.data ?? null,
    nameBadges: badges.data?.name_badges === true,
    rateCard: rateCard.data ?? [],
    dressCodeLibrary: dressCodeLibrary(
      (library.data ?? []).map((card: { dress_codes: string[] | null }) => card.dress_codes),
    ),
    // The selfie is a private-bucket key; signed here, initials if not.
    qualified: await withPhotoUrls(qualified.data ?? []),
    requirements: requirements.data ?? [],
    quizResults: quizResults.data ?? [],
    events: events.data ?? [],
    roles: roleOptions,
    staff: staff.data ?? [],
    problem: null,
  };
}
