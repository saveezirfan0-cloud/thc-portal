import { RTW_CHECK_COLUMNS, rtwChecksByDocument } from './rtwCheck';
import type { RtwCheckRow, RtwCheckView } from './rtwCheck';

/**
 * Reads `rtw_checks` for the three screens that show a share code report
 * (ADR-0025). Server-side, through the caller's SESSION client: the table's
 * only policy is admin_read, so anyone else reads nothing and the screen
 * falls back to the manual flow.
 *
 * The generated types do not know the table yet, so the client is narrowed
 * to the two filters used here rather than hand-editing types.generated.ts
 * (the same pattern as compliance/actions.ts `RpcClient`).
 *
 * A failed read is not a failed page: no checks means every share code
 * shows exactly what it showed before the automated check existed.
 */
type RtwCheckResponse = PromiseLike<{
  data: RtwCheckRow[] | null;
  error: { message: string } | null;
}>;

interface RtwCheckFilter {
  in(column: 'document_id', values: string[]): RtwCheckResponse;
  eq(column: 'staff_id', value: string): RtwCheckResponse;
}

interface RtwCheckClient {
  from(table: 'rtw_checks'): { select(columns: string): RtwCheckFilter };
}

export type RtwCheckScope = { documentIds: readonly string[] } | { staffId: string };

export async function readRtwChecks(
  client: unknown,
  scope: RtwCheckScope,
): Promise<Record<string, RtwCheckView>> {
  const ids = 'staffId' in scope ? [] : [...new Set(scope.documentIds)];
  if (!('staffId' in scope) && ids.length === 0) return {};
  try {
    const query = (client as RtwCheckClient).from('rtw_checks').select(RTW_CHECK_COLUMNS);
    if ('staffId' in scope) {
      const { data, error } = await query.eq('staff_id', scope.staffId);
      return error ? {} : rtwChecksByDocument(data);
    }
    const { data, error } = await query.in('document_id', ids);
    return error ? {} : rtwChecksByDocument(data);
  } catch {
    return {};
  }
}
