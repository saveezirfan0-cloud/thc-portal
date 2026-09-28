import { RTW_CHECK_COLUMNS, parseRtwCheckRow } from './rtwCheck';
import type { RtwCheckRow } from './rtwCheck';
import { parseDobClaim } from './dobCorrection';
import type { DobClaim } from './dobCorrection';

/**
 * Reads for the automated right-to-work check on the office's screens
 * (ADR-0025). Both are best-effort: a failed read shows the document as it
 * was before the automation existed, never a broken page.
 */

interface Query {
  select(columns: string): Query;
  eq(column: string, value: string): Query;
  in(column: string, values: readonly string[]): Query;
  then: PromiseLike<{ data: unknown; error: unknown }>['then'];
}
interface Client {
  from(table: string): { select(columns: string): Query };
  rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface RtwChecksRead {
  checks: RtwCheckRow[];
  /** settings.rtw_check.enabled — decides "Run check again" and the manual date. */
  enabled: boolean;
  /**
   * ADR-0069: pending share codes whose worker entered a different date of
   * birth — Verify copies it to the profile, so the screen says so.
   */
  dobClaims: DobClaim[];
}

const DOB_CLAIM_COLUMNS = 'document_id, staff_id, claimed_dob, profile_dob, opt_out_signed_under_18';

function claimsFrom(result: { data: unknown; error: unknown }): DobClaim[] {
  if (result.error) return [];
  return ((result.data as Record<string, unknown>[] | null) ?? [])
    .map(parseDobClaim)
    .filter((c): c is DobClaim => c !== null);
}

export async function loadRtwChecks(client: unknown, staffId: string): Promise<RtwChecksRead> {
  const supabase = client as Client;
  try {
    const [rows, enabled, claims] = await Promise.all([
      supabase.from('rtw_checks_latest_v').select(RTW_CHECK_COLUMNS).eq('staff_id', staffId),
      supabase.rpc('rtw_check_enabled'),
      supabase.from('share_code_dob_claims_v').select(DOB_CLAIM_COLUMNS).eq('staff_id', staffId),
    ]);
    const checks = rows.error
      ? []
      : ((rows.data as Record<string, unknown>[] | null) ?? [])
          .map(parseRtwCheckRow)
          .filter((r): r is RtwCheckRow => r !== null);
    return { checks, enabled: !enabled.error && enabled.data === true, dobClaims: claimsFrom(claims) };
  } catch {
    return { checks: [], enabled: false, dobClaims: [] };
  }
}

export async function loadRtwCheckEnabled(client: unknown): Promise<boolean> {
  try {
    const { data, error } = await (client as Client).rpc('rtw_check_enabled');
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * The latest check of each of these documents, keyed by document id — for
 * /compliance, whose queue view names the check but not what ADR-0041 added
 * to it (the recommendation, the suggested N8 text, the photo). One
 * `in('document_id', …)` read; best-effort, so a failure leaves the queue as
 * it was (the date typed by hand, an empty Reject box).
 */
export async function loadRtwChecksForDocuments(
  client: unknown,
  documentIds: readonly string[],
): Promise<Map<string, RtwCheckRow>> {
  const map = new Map<string, RtwCheckRow>();
  const ids = [...new Set(documentIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const { data, error } = await (client as Client)
      .from('rtw_checks_latest_v')
      .select(RTW_CHECK_COLUMNS)
      .in('document_id', ids);
    if (error) return map;
    for (const raw of (data as Record<string, unknown>[] | null) ?? []) {
      const row = parseRtwCheckRow(raw);
      if (row) map.set(row.document_id, row);
    }
  } catch {
    return map;
  }
  return map;
}

/**
 * ADR-0069: the date of birth entered with each of these pending share
 * codes, keyed by document id — for /compliance. Best-effort: a failed read
 * shows no line, and Verify still does what it does.
 */
export async function loadDobClaimsForDocuments(
  client: unknown,
  documentIds: readonly string[],
): Promise<Map<string, DobClaim>> {
  const map = new Map<string, DobClaim>();
  const ids = [...new Set(documentIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const result = await (client as Client)
      .from('share_code_dob_claims_v')
      .select(DOB_CLAIM_COLUMNS)
      .in('document_id', ids);
    for (const claim of claimsFrom(result)) map.set(claim.documentId, claim);
  } catch {
    return map;
  }
  return map;
}
