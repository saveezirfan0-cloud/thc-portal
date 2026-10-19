import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Back Office sign-in policy (ADR-0164): is two-step compulsory, how
 * long does a sign-in last, and when did THIS session sign in.
 *
 * Owner-set on /settings (`settings.office_two_step_required`, default on;
 * `settings.office_session_max_hours`, default 12), read through
 * `office_session_policy()`, which also answers the caller's own
 * `auth.sessions.created_at` — the moment of the sign-in, which a token
 * refresh never moves. The database enforces both in `current_app_role()`;
 * the middleware asks so the manager meets the enrol step or the sign-in
 * form instead of a page with no data on it.
 *
 * Pure apart from `readOfficePolicy`, which is one RPC.
 */
export interface OfficePolicy {
  twoStepRequired: boolean;
  /** Null when the database predates the setting (no cap from the app). */
  sessionMaxHours: number | null;
  /** When this session signed in (epoch ms); null when unknown. */
  sessionStartedAt: number | null;
}

/**
 * The database before 20261020130000 (no such function): the rules as they
 * were — two-step opt-in, no session cap. Never a guess in the other
 * direction, which would lock every office login out until it migrates.
 */
export const LEGACY_POLICY: OfficePolicy = {
  twoStepRequired: false,
  sessionMaxHours: null,
  sessionStartedAt: null,
};

/** The RPC's answer, read defensively: anything odd is the safe value. */
export function parseOfficePolicy(data: unknown): OfficePolicy {
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const hours = Number(row['sessionMaxHours']);
  const started =
    typeof row['sessionStartedAt'] === 'string' ? Date.parse(row['sessionStartedAt']) : NaN;
  return {
    // Only a literal false turns it off (fail closed, as the database).
    twoStepRequired: row['twoStepRequired'] !== false,
    sessionMaxHours: Number.isFinite(hours) && hours > 0 ? hours : 12,
    sessionStartedAt: Number.isFinite(started) ? started : null,
  };
}

/** True once a session is older than the policy allows. */
export function sessionExpired(policy: OfficePolicy, nowMs: number): boolean {
  if (policy.sessionStartedAt === null || policy.sessionMaxHours === null) return false;
  return nowMs - policy.sessionStartedAt > policy.sessionMaxHours * 3_600_000;
}

export type PolicyRead = { ok: true; policy: OfficePolicy } | { ok: false };

/** PostgREST / Postgres: the function is not there (a database not yet migrated). */
function isMissingFunction(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

/**
 * Ask the database. `{ ok: false }` is "could not tell" — slow, down, or a
 * client without the call — never "not required".
 */
export async function readOfficePolicy(supabase: Pick<SupabaseClient, 'rpc'>): Promise<PolicyRead> {
  try {
    const { data, error } = await supabase.rpc('office_session_policy');
    if (error) {
      if (isMissingFunction(error)) return { ok: true, policy: LEGACY_POLICY };
      console.error('[office-policy] office_session_policy failed', { code: error.code });
      return { ok: false };
    }
    return { ok: true, policy: parseOfficePolicy(data) };
  } catch {
    return { ok: false };
  }
}
