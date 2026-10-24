'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import type { DbError } from '../../_lib/dbError';
import { supabaseConfigured } from '../data';
import {
  cleanAliases,
  normaliseList,
  rateProblem,
  settingsProblem,
  timesheetInvoicingProblem,
} from './timesheetInvoicing';
import type { RateInput, TimesheetSettingsInput } from './timesheetInvoicing';
import type { ActionResult } from './types';

/**
 * Writes for the client card's Timesheet invoicing panel (ADR-0210).
 *
 * The settings go through `set_client_timesheet_invoicing()`: finance callers
 * that may write, audited as `client.timesheet_invoicing`, and a timesheet
 * client is also left out of event invoicing (ADR-0203) in the same
 * statement. The rate card is `timesheet_rates`, written directly under its
 * `admin_finance_write` policy (finance and write, so a viewer and a
 * scheduler are refused by the database, not by this file).
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Reply = PromiseLike<{ data?: unknown; error: DbError | null }>;

interface Db {
  rpc(fn: string, args: Record<string, unknown>): Reply;
  from(table: 'timesheet_rates'): {
    insert(row: Record<string, unknown>): { select(columns: string): Reply };
    update(row: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): { eq(column: string, value: string): { select(columns: string): Reply } };
    };
    delete(): {
      eq(
        column: string,
        value: string,
      ): { eq(column: string, value: string): { select(columns: string): Reply } };
    };
  };
}

const GONE: ActionResult = {
  ok: false,
  message: 'That rate no longer exists, or your login cannot change it. Refresh the page.',
};

function refresh(clientId: string): void {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
}

/** Save the panel. Nothing is written if the settings are not valid. */
export async function saveTimesheetInvoicing(
  clientId: string,
  input: TimesheetSettingsInput,
): Promise<ActionResult> {
  if (!UUID.test(clientId))
    return { ok: false, message: 'That client no longer exists. Refresh the page.' };
  const clean: TimesheetSettingsInput = {
    ...input,
    displayName: String(input.displayName ?? '').trim(),
    venue: String(input.venue ?? '').trim(),
    venueAddress: String(input.venueAddress ?? '').trim(),
    dateLabel: String(input.dateLabel ?? '').trim(),
    defaultRole: String(input.defaultRole ?? '').trim(),
    excludedStaff: normaliseList(input.excludedStaff ?? []),
    omitEventDates: input.omitEventDates === true,
    poRequired: input.poRequired === true,
    paymentTermsDays:
      input.paymentTermsDays === null || input.paymentTermsDays === undefined
        ? null
        : Number(input.paymentTermsDays),
  };
  const invalid = settingsProblem(clean);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const db = createClient(await cookies()) as unknown as Db;
  const { error } = await db.rpc('set_client_timesheet_invoicing', {
    p_client: clientId,
    p_mode: clean.mode,
    p_format: clean.format,
    p_display_name: clean.displayName || null,
    p_venue: clean.venue || null,
    p_venue_address: clean.venueAddress || null,
    p_date_label: clean.dateLabel || null,
    p_omit_dates: clean.omitEventDates,
    p_default_role: clean.defaultRole || null,
    p_excluded_staff: clean.excludedStaff,
    p_po_required: clean.poRequired,
    p_terms_days: clean.paymentTermsDays,
  });
  if (error) return { ok: false, message: timesheetInvoicingProblem(error) };
  refresh(clientId);
  return { ok: true };
}

function rateRow(input: RateInput) {
  return {
    role_name: input.roleName.trim(),
    aliases: cleanAliases(input.roleName, input.aliases),
    charge_rate: input.chargeRate,
  };
}

export async function addTimesheetRate(clientId: string, input: RateInput): Promise<ActionResult> {
  if (!UUID.test(clientId))
    return { ok: false, message: 'That client no longer exists. Refresh the page.' };
  const invalid = rateProblem(input);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const db = createClient(await cookies()) as unknown as Db;
  const { error } = await db
    .from('timesheet_rates')
    .insert({ client_id: clientId, ...rateRow(input) })
    .select('id');
  if (error) return { ok: false, message: timesheetInvoicingProblem(error) };
  refresh(clientId);
  return { ok: true };
}

export async function updateTimesheetRate(
  clientId: string,
  id: string,
  input: RateInput,
): Promise<ActionResult> {
  if (!UUID.test(clientId) || !UUID.test(id)) return GONE;
  const invalid = rateProblem(input);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const db = createClient(await cookies()) as unknown as Db;
  const { data, error } = await db
    .from('timesheet_rates')
    .update(rateRow(input))
    .eq('id', id)
    .eq('client_id', clientId)
    .select('id');
  if (error) return { ok: false, message: timesheetInvoicingProblem(error) };
  // RLS hides a row the caller may not change: no error, no row.
  if (!Array.isArray(data) || data.length === 0) return GONE;
  refresh(clientId);
  return { ok: true };
}

/**
 * Drops a role from the rate card. Invoices already issued keep the rate
 * they were issued at (an issued invoice is final); timesheet rows still in
 * review keep the rate they were given, and a new upload for the role finds
 * no rate until it is added again.
 */
export async function removeTimesheetRate(clientId: string, id: string): Promise<ActionResult> {
  if (!UUID.test(clientId) || !UUID.test(id)) return GONE;
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const db = createClient(await cookies()) as unknown as Db;
  const { data, error } = await db
    .from('timesheet_rates')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)
    .select('id');
  if (error) return { ok: false, message: timesheetInvoicingProblem(error) };
  if (!Array.isArray(data) || data.length === 0) return GONE;
  refresh(clientId);
  return { ok: true };
}
