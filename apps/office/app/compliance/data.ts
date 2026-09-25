import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { loadRtwCheckEnabled } from '../_lib/rtwCheckData';
import type { AuditRow, CompliancePageData, QueueRow, RadarRow, WarningRow } from './types';

/**
 * Reads for /compliance (§4.1).
 *
 * Every source is a security_invoker view over tables whose only
 * cross-worker policy is admin's, so a session that is not the office's sees
 * empty lists — the database is the gate, as on /staff and /checkin.
 */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

const NOT_CONFIGURED =
  'This environment has no Supabase project, so the compliance queue cannot be read. See docs/04-setup-github-vercel-supabase.md.';

export async function loadCompliance(): Promise<CompliancePageData> {
  const empty: CompliancePageData = {
    queue: [],
    radar: [],
    warnings: [],
    rotaGuardMode: 'block',
    rtwCheckEnabled: false,
    problem: null,
  };
  if (!supabaseConfigured()) return { ...empty, problem: NOT_CONFIGURED };

  const supabase = createClient(await cookies());
  const [queue, radar, warnings, mode, rtwCheckEnabled] = await Promise.all([
    // `*` is every column of the view, in QueueRow's shape — including
    // review_reason (20260927160000) and manual_review_reason
    // (20260928110900), which the row renders beside the AI badge.
    supabase
      .from('compliance_review_queue_v')
      .select('*')
      .order('submitted_at', { ascending: true })
      .returns<QueueRow[]>(),
    supabase
      .from('compliance_radar_v')
      .select('*')
      .order('days_left', { ascending: true })
      .returns<RadarRow[]>(),
    supabase
      .from('rota_guard_warnings_v')
      .select('*')
      .order('at', { ascending: false })
      .limit(50)
      .returns<WarningRow[]>(),
    supabase
      .from('settings')
      .select('value')
      .eq('key', 'rota_guard_mode')
      .maybeSingle<{ value: unknown }>(),
    loadRtwCheckEnabled(supabase),
  ]);

  const problem = queue.error?.message ?? radar.error?.message ?? warnings.error?.message ?? null;
  if (problem) return { ...empty, problem };

  return {
    queue: queue.data ?? [],
    radar: radar.data ?? [],
    warnings: warnings.data ?? [],
    // Mirrors rota_guard_mode(): anything but an explicit 'warn' is block.
    rotaGuardMode: mode.data?.value === 'warn' ? 'warn' : 'block',
    rtwCheckEnabled,
    problem: null,
  };
}

/** The whole trail, for the CSV export (acceptance criterion 7). */
export async function loadAuditTrail(): Promise<{ rows: AuditRow[]; problem: string | null }> {
  if (!supabaseConfigured()) return { rows: [], problem: NOT_CONFIGURED };
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from('compliance_evidence_audit_v')
    .select('*')
    .order('at', { ascending: true })
    .order('id', { ascending: true })
    .returns<AuditRow[]>();
  if (error) return { rows: [], problem: error.message };
  return { rows: data ?? [], problem: null };
}
