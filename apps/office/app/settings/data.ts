import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readBufferRule } from '@thc/domain';
import { TEMPLATES, switchedOff } from '@thc/notifications';
import { readInvoicing, readWeights, validateSessionHours } from './validate';
import { OFFICE_COPY_SETTING_KEY, readOfficeCopy } from './officeCopy';
import type { SettingsData, Senders, VenueTypeRadius, WilloStageMap } from './types';
import { readProblem } from '../_lib/dbError';

/**
 * Reads for /settings (§6, §2.4, §9.11, §9.12).
 *
 * `settings` carries one admin-only policy (0001), so RLS is the gate:
 * this screen does not test the caller's role, the database refuses a
 * caller who is not an admin.
 *
 * Every value falls back to what the product shipped with rather than to
 * zero or empty. An operator who has never opened this screen must see the
 * behaviour the system actually has — and a key that has somehow been
 * deleted must not silently become "no weighting at all".
 */

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  );
}

const DEFAULT_WILLO: WilloStageMap = {
  new_response: 'interview_completed',
  accepted: 'documents',
  rejected: 'rejected',
};

const DEFAULT_SENDERS: Senders = {
  timesheets: 'timesheets@thehospitalitycompany.co.uk',
  admin: 'admin@thehospitalitycompany.co.uk',
};

const NOT_CONFIGURED =
  'This environment has no Supabase project, so system settings cannot be read. See docs/04-setup-github-vercel-supabase.md.';

/** E5/E6 go to payroll and Gisela, E7 to admin@ and payroll (§8) — from the register itself. */
const RECIPIENTS = {
  e5e6: [...(TEMPLATES.E5.recipients ?? [])],
  e7: [...(TEMPLATES.E7.recipients ?? [])],
};

function sessionHoursOf(raw: unknown): number {
  return typeof raw === 'number' && validateSessionHours(raw) === null ? raw : 12;
}

export async function loadSettings(): Promise<SettingsData> {
  const empty: SettingsData = {
    weights: readWeights(null),
    willo: DEFAULT_WILLO,
    willoReviewUrlTemplate: null,
    willoInterviewUrl: null,
    senders: DEFAULT_SENDERS,
    documentOfficeCopy: [],
    recipients: RECIPIENTS,
    bookedElsewhereGapMinutes: 120,
    escalationRadiusMiles: 3,
    venueTypes: [],
    rotaGuardMode: 'block',
    bufferSuggestion: readBufferRule(null),
    notificationsOff: [],
    clientPortalPhone: '',
    officeTwoStepRequired: true,
    officeSessionMaxHours: 12,
    invoicing: readInvoicing(null),
    problem: null,
  };

  if (!supabaseConfigured()) return { ...empty, problem: NOT_CONFIGURED };

  const supabase = createClient(await cookies());
  const [settings, venueTypes] = await Promise.all([
    supabase.from('settings').select('key, value').returns<{ key: string; value: unknown }[]>(),
    supabase
      .from('venue_types')
      .select('key, label, default_radius_m, sort_order')
      .order('sort_order')
      .returns<VenueTypeRadius[]>(),
  ]);

  const problem = readProblem(settings.error ?? venueTypes.error);
  if (problem) return { ...empty, problem };

  const byKey = new Map((settings.data ?? []).map((row) => [row.key, row.value]));
  const number = (key: string, fallback: number): number => {
    const raw = byKey.get(key);
    const value = typeof raw === 'string' ? Number(raw) : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const object = <T>(key: string, fallback: T): T => {
    const raw = byKey.get(key);
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? ({ ...fallback, ...raw } as T)
      : fallback;
  };

  return {
    weights: readWeights(byKey.get('scoring_weights')),
    willo: object('willo_stage_map', DEFAULT_WILLO),
    // The view substitutes only a JSON string (jsonb_typeof = 'string'), so
    // anything else — the seeded JSON null, a missing row — is "not set".
    willoReviewUrlTemplate:
      typeof byKey.get('willo_review_url_template') === 'string'
        ? (byKey.get('willo_review_url_template') as string)
        : null,
    willoInterviewUrl:
      typeof byKey.get('willo_interview_public_url') === 'string'
        ? (byKey.get('willo_interview_public_url') as string)
        : null,
    senders: object('senders', DEFAULT_SENDERS),
    // document_office_copy()'s reading: anything but { emails: [...] } is off.
    documentOfficeCopy: readOfficeCopy(byKey.get(OFFICE_COPY_SETTING_KEY)),
    recipients: RECIPIENTS,
    bookedElsewhereGapMinutes: number('booked_elsewhere_gap_minutes', 120),
    escalationRadiusMiles: number('escalation_radius_miles', 3),
    venueTypes: venueTypes.data ?? [],
    // rota_guard_mode() fails closed; so does the screen.
    rotaGuardMode: byKey.get('rota_guard_mode') === 'warn' ? 'warn' : 'block',
    // ADR-0181: the Shift Builder's reading — the default when missing or malformed.
    bufferSuggestion: readBufferRule(byKey.get('buffer_suggestion')),
    // Read by the same rule as notification_switched_on(): only a JSON false is off.
    notificationsOff: switchedOff(byKey.get('notification_switches')),
    // client_portal_contact_v reads only a JSON string, so does the screen.
    clientPortalPhone:
      typeof byKey.get('client_portal_phone') === 'string'
        ? (byKey.get('client_portal_phone') as string)
        : '',
    // office_security_settings()'s reading: only a JSON false is off, and
    // anything but a whole number from 1 to 24 is the default 12.
    officeTwoStepRequired: byKey.get('office_two_step_required') !== false,
    officeSessionMaxHours: sessionHoursOf(byKey.get('office_session_max_hours')),
    // ADR-0176: invoicing_config()'s reading — off when the row is missing.
    invoicing: readInvoicing(byKey.get('invoicing')),
    problem: null,
  };
}
