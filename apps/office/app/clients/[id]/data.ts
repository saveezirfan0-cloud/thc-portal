import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readAllPages } from '@thc/db/paged';
import { supabaseConfigured } from '../data';
import { dressCodeLibrary } from './card';
import { withPhotoUrls } from '../../_lib/photos';
import type { Client } from '../types';
import type {
  ClientCardData,
  TimesheetInvoicingSettings,
  TimesheetRateRow,
  ClientEventRow,
  QualifiedStaffRow,
  QuizResultRow,
  RateCardRow,
  RoleOption,
  ShiftRequirementRow,
  WorkerRequestRow,
} from './types';
import { readProblem } from '../../_lib/dbError';

/**
 * Reads for /clients/:id (§9.7).
 *
 * `roles` is the rate card's "+ Add role" picker. The role list is the
 * whole §9.8 catalogue, not the client's own rate card: §9.7 says a role
 * missing from the dropdown "must first be created in the Roles section",
 * which only makes sense if the dropdown shows the catalogue. The "+ Add
 * staff" picker reads nothing here: it searches the server a page at a time
 * as the manager types (`searchQualifyPicker` in ./actions.ts).
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
  excludeFromInvoicing: false,
  lineupEmails: { confirmed: true, changed: true },
  invoicing: {
    accountsContactName: null,
    invoiceEmails: [],
    invoiceCcEmails: [],
    billingAddress: null,
  },
  rateCard: [],
  dressCodeLibrary: [],
  qualified: [],
  requirements: [],
  quizResults: [],
  workerRequests: [],
  events: [],
  roles: [],
};

/**
 * The two ADR-0110 views are newer than the generated types; the loader
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
  from(view: 'clients_worker_requests_v'): { select(columns: '*'): RequestQuery };
}

/** ADR-0135 §2: open first, newest first, at most 50 (832 holds the view's columns). */
interface RequestQuery extends PromiseLike<{
  data: WorkerRequestRow[] | null;
  error: { message: string } | null;
}> {
  eq(column: string, value: string): RequestQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): RequestQuery;
  limit(count: number): RequestQuery;
}

const CLIENT_COLUMNS =
  'id, name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, ' +
  'pays_buffer, rate_card_roles, rate_card_count, event_count, avg_margin_pct, archived_at';

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

interface TimesheetClientRow {
  invoicing_mode: string | null;
  invoice_format: string | null;
  invoice_display_name: string | null;
  invoice_venue: string | null;
  invoice_venue_address: string | null;
  invoice_date_label: string | null;
  omit_event_dates_in_subject: boolean | null;
  timesheet_default_role: string | null;
  timesheet_excluded_staff: string[] | null;
  po_required: boolean | null;
  payment_terms_days: number | null;
  xero_contact_id: string | null;
}

interface TimesheetDb {
  from(table: 'clients'): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: TimesheetClientRow | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  from(table: 'timesheet_rates'): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        order(column: string): PromiseLike<{
          data:
            | {
                id: string;
                role_name: string;
                aliases: string[] | null;
                charge_rate: number | string;
              }[]
            | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/** The card's timesheet-invoice columns (20261027100000). */
async function readTimesheetSettings(
  supabase: unknown,
  id: string,
): Promise<{ data: TimesheetInvoicingSettings | null; error: { message: string } | null }> {
  const reply = await (supabase as TimesheetDb)
    .from('clients')
    .select(
      'invoicing_mode, invoice_format, invoice_display_name, invoice_venue, invoice_venue_address, ' +
        'invoice_date_label, omit_event_dates_in_subject, timesheet_default_role, ' +
        'timesheet_excluded_staff, po_required, payment_terms_days, xero_contact_id',
    )
    .eq('id', id)
    .maybeSingle();
  if (reply.error) return { data: null, error: reply.error };
  const row = reply.data;
  if (!row) return { data: null, error: null };
  return {
    error: null,
    data: {
      mode: row.invoicing_mode === 'timesheet' ? 'timesheet' : 'events',
      format: row.invoice_format === 'aggregated' ? 'aggregated' : 'named',
      displayName: row.invoice_display_name,
      venue: row.invoice_venue,
      venueAddress: row.invoice_venue_address,
      dateLabel: row.invoice_date_label,
      omitEventDates: row.omit_event_dates_in_subject === true,
      defaultRole: row.timesheet_default_role,
      excludedStaff: row.timesheet_excluded_staff ?? [],
      poRequired: row.po_required === true,
      paymentTermsDays: row.payment_terms_days,
      xeroContactId: row.xero_contact_id,
    },
  };
}

async function readTimesheetRates(
  supabase: unknown,
  id: string,
): Promise<{ data: TimesheetRateRow[] | null; error: { message: string } | null }> {
  const reply = await (supabase as TimesheetDb)
    .from('timesheet_rates')
    .select('id, role_name, aliases, charge_rate')
    .eq('client_id', id)
    .order('role_name');
  if (reply.error) return { data: null, error: reply.error };
  return {
    error: null,
    data: (reply.data ?? []).map((row) => ({
      id: row.id,
      role_name: row.role_name,
      aliases: row.aliases ?? [],
      charge_rate: Number(row.charge_rate),
    })),
  };
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
    requirements,
    quizResults,
    workerRequests,
    timesheet,
    timesheetRates,
  ] = await Promise.all([
    supabase.from('clients_directory_v').select(CLIENT_COLUMNS).eq('id', id).maybeSingle<Client>(),
    // ADR-0081: one switch, read from the table rather than restating the view.
    // ADR-0135 §3: and the two line-up email switches beside it.
    // ADR-0176: and the Invoicing panel's three columns.
    supabase
      .from('clients')
      .select(
        'name_badges, exclude_from_invoicing, lineup_confirmed_emails, lineup_changed_emails, ' +
          'accounts_contact_name, invoice_emails, invoice_cc_emails, billing_address',
      )
      .eq('id', id)
      .maybeSingle<{
        name_badges: boolean | null;
        exclude_from_invoicing: boolean | null;
        lineup_confirmed_emails: boolean | null;
        lineup_changed_emails: boolean | null;
        accounts_contact_name: string | null;
        invoice_emails: string[] | null;
        invoice_cc_emails: string[] | null;
        billing_address: string | null;
      }>(),
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
    // Block 3 and block 6 grow with the client: one row per cleared worker,
    // one per event ever run. PostgREST stops at 1000 rows without an error,
    // so both are paged in a total order (go-live audit M2) — a cut list
    // would understate the Wave 1 pool, or lose the oldest events.
    readAllPages<QualifiedStaffRow>(
      (range) =>
        supabase
          .from('clients_qualified_staff_v')
          .select('*')
          .eq('client_id', id)
          .order('display_name')
          .order('staff_id')
          .range(range.from, range.to)
          .returns<QualifiedStaffRow[]>(),
      { what: 'qualified staff', key: (row) => row.staff_id },
    ),
    readAllPages<ClientEventRow>(
      (range) =>
        supabase
          .from('clients_event_list_v')
          .select('*')
          .eq('client_id', id)
          .order('event_date', { ascending: false })
          .order('id')
          .range(range.from, range.to)
          .returns<ClientEventRow[]>(),
      { what: 'events', key: (row) => row.id },
    ),
    supabase
      .from('roles')
      .select('id, name')
      .order('name')
      .returns<{ id: string; name: string }[]>(),
    // ADR-0061: the catalogue base pay beside each role in the "+ Add" picker.
    ratesVisible
      ? supabase.from('role_rates_v').select('role_id, pay_rate')
      : Promise.resolve({ data: [], error: null }),
    // ADR-0110: what each role asks, and who has sat the quiz.
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
    // ADR-0135 §2: the Client Portal's "Request again" messages.
    requirementsDb
      .from('clients_worker_requests_v')
      .select('*')
      .eq('client_id', id)
      .order('handled_at', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: false })
      .limit(50),
    // ADR-0210: the Timesheet invoicing panel and its rate card. Money, so
    // finance only (ratesVisible): a scheduler's card draws no panel.
    ratesVisible ? readTimesheetSettings(supabase, id) : Promise.resolve(null),
    ratesVisible ? readTimesheetRates(supabase, id) : Promise.resolve(null),
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
    requirements.error ??
    quizResults.error ??
    workerRequests.error ??
    timesheet?.error ??
    timesheetRates?.error;
  if (error) return { ...EMPTY, problem: readProblem(error) };

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
    excludeFromInvoicing: badges.data?.exclude_from_invoicing === true,
    lineupEmails: {
      confirmed: badges.data?.lineup_confirmed_emails !== false,
      changed: badges.data?.lineup_changed_emails !== false,
    },
    invoicing: {
      accountsContactName: badges.data?.accounts_contact_name ?? null,
      invoiceEmails: badges.data?.invoice_emails ?? [],
      invoiceCcEmails: badges.data?.invoice_cc_emails ?? [],
      billingAddress: badges.data?.billing_address ?? null,
    },
    ...(timesheet?.data ? { timesheetInvoicing: timesheet.data } : {}),
    ...(timesheetRates?.data ? { timesheetRates: timesheetRates.data } : {}),
    rateCard: rateCard.data ?? [],
    dressCodeLibrary: dressCodeLibrary(
      (library.data ?? []).map((card: { dress_codes: string[] | null }) => card.dress_codes),
    ),
    // The selfie is a private-bucket key; signed here, initials if not.
    qualified: await withPhotoUrls(qualified.data ?? []),
    requirements: requirements.data ?? [],
    quizResults: quizResults.data ?? [],
    workerRequests: workerRequests.data ?? [],
    events: events.data ?? [],
    roles: roleOptions,
    problem: null,
  };
}
