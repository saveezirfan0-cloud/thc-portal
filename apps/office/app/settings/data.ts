import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { TEMPLATES } from '@thc/notifications';
import { readWeights } from './validate';
import type { SettingsData, Senders, VenueTypeRadius, WilloStageMap } from './types';

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

export async function loadSettings(): Promise<SettingsData> {
  const empty: SettingsData = {
    weights: readWeights(null),
    willo: DEFAULT_WILLO,
    willoReviewUrlTemplate: null,
    senders: DEFAULT_SENDERS,
    recipients: RECIPIENTS,
    bookedElsewhereGapMinutes: 120,
    escalationRadiusMiles: 3,
    venueTypes: [],
    rotaGuardMode: 'block',
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

  const problem = settings.error?.message ?? venueTypes.error?.message ?? null;
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
    senders: object('senders', DEFAULT_SENDERS),
    recipients: RECIPIENTS,
    bookedElsewhereGapMinutes: number('booked_elsewhere_gap_minutes', 120),
    escalationRadiusMiles: number('escalation_radius_miles', 3),
    venueTypes: venueTypes.data ?? [],
    // rota_guard_mode() fails closed; so does the screen.
    rotaGuardMode: byKey.get('rota_guard_mode') === 'warn' ? 'warn' : 'block',
    problem: null,
  };
}
