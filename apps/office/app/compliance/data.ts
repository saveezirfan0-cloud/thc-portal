import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readAllPages } from '@thc/db/paged';
import {
  loadDobClaimsForDocuments,
  loadRtwCheckEnabled,
  loadRtwChecksForDocuments,
} from '../_lib/rtwCheckData';
import { EMPTY_MONITOR } from './checks';
import { loadCheckMonitor } from './checksData';
import { withLatestCheck } from './queue';
import type { AuditRow, CompliancePageData, QueueRow, RadarRow, WarningRow } from './types';
import { readProblem } from '../_lib/dbError';

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
    checkMonitor: EMPTY_MONITOR,
    problem: null,
  };
  if (!supabaseConfigured()) return { ...empty, problem: NOT_CONFIGURED };

  const supabase = createClient(await cookies());
  const [queue, radar, warnings, mode, rtwCheckEnabled, checkMonitor] = await Promise.all([
    // `*` is every column of the view, in QueueRow's shape — including
    // review_reason (20260927160000) and manual_review_reason
    // (20260928110900), which the row renders beside the AI badge.
    //
    // Paged: at full intake (the invite roster arriving, several documents
    // each) the queue passes PostgREST's 1000-row cap, and oldest-first the
    // cut would drop the NEWEST uploads without a word. A row is one item of
    // one kind, so (submitted_at, kind, item_id) is a total order. The menu's
    // "Needs review" badge is a separate HEAD count (navCounts.ts).
    readAllPages<QueueRow>(
      (range) =>
        supabase
          .from('compliance_review_queue_v')
          .select('*')
          .order('submitted_at', { ascending: true })
          .order('kind', { ascending: true })
          .order('item_id', { ascending: true })
          .range(range.from, range.to)
          .returns<QueueRow[]>(),
      { what: 'items to review', key: (row) => `${row.kind}:${row.item_id}` },
    ),
    // Every dated document on a live worker — about two per worker, so past
    // PostgREST's 1000-row cap at full roster. Read whole, so "All N", the
    // tab counts and the valid list are right (go-live audit H7); doc_id
    // breaks ties in days_left so no row is lost at a page boundary.
    readAllPages<RadarRow>(
      (range) =>
        supabase
          .from('compliance_radar_v')
          .select('*')
          .order('days_left', { ascending: true })
          .order('doc_id', { ascending: true })
          .range(range.from, range.to)
          .returns<RadarRow[]>(),
      { what: 'dated documents', key: (row) => row.doc_id },
    ),
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
    loadCheckMonitor(supabase, new Date().toISOString()),
  ]);

  const problem = readProblem(queue.error ?? radar.error ?? warnings.error);
  if (problem) return { ...empty, problem };

  // ADR-0041: the recommendation, the suggested N8 text and the photo live on
  // rtw_checks_latest_v, not on the queue view — one read for every share
  // code on the queue, merged by document id.
  const rows = queue.data ?? [];
  const [checks, claims] = await Promise.all([
    loadRtwChecksForDocuments(
      supabase,
      rows
        .filter(
          (row) =>
            row.kind === 'document' && row.item_type === 'share_code_report' && row.rtw_check_id,
        )
        .map((row) => row.item_id),
    ),
    // ADR-0070: the date of birth entered with a pending share code.
    loadDobClaimsForDocuments(
      supabase,
      rows
        .filter((row) => row.kind === 'document' && row.item_type === 'share_code_report')
        .map((row) => row.item_id),
    ),
  ]);

  return {
    queue: rows.map((row) => ({
      ...withLatestCheck(row, checks.get(row.item_id)),
      dob_claim: claims.get(row.item_id) ?? null,
    })),
    radar: radar.data ?? [],
    warnings: warnings.data ?? [],
    // Mirrors rota_guard_mode(): anything but an explicit 'warn' is block.
    rotaGuardMode: mode.data?.value === 'warn' ? 'warn' : 'block',
    rtwCheckEnabled,
    checkMonitor,
    problem: null,
  };
}

/** Years of evidence events; past it the export says so rather than cut the file. */
export const AUDIT_TRAIL_CEILING = 200_000;

/** The whole trail, for the CSV export (acceptance criterion 7). */
export async function loadAuditTrail(): Promise<{ rows: AuditRow[]; problem: string | null }> {
  if (!supabaseConfigured()) return { rows: [], problem: NOT_CONFIGURED };
  const supabase = createClient(await cookies());
  // Oldest first, so a single read past PostgREST's 1000-row cap dropped
  // the NEWEST verifications — the ones an auditor asks for (go-live audit
  // H6). Read whole, by (at, id); a trail too long to export is an error.
  const { data, error } = await readAllPages<AuditRow>(
    (range) =>
      supabase
        .from('compliance_evidence_audit_v')
        .select('*')
        .order('at', { ascending: true })
        .order('id', { ascending: true })
        .range(range.from, range.to)
        .returns<AuditRow[]>(),
    { what: 'audit trail rows', key: (row) => String(row.id), ceiling: AUDIT_TRAIL_CEILING },
  );
  if (error) return { rows: [], problem: readProblem(error) };
  return { rows: data, problem: null };
}
