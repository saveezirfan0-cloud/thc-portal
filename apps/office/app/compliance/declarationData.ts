/**
 * ADR-0180: what an UPDATED declaration answers, for the Needs review row.
 *
 * Not a column of compliance_review_queue_v: staff_declarations_v carries
 * it (`previous_status`, `previous_worker_message`, 20261022170100), so one
 * read for the queue's declarations, merged by id. A failed read leaves the
 * rows as they were — the row still reads, without the "updated" badge.
 */

/** The fields merged onto a declaration's QueueRow. */
export interface DeclarationFollowUpFields {
  declaration_previous_status: string | null;
  declaration_previous_message: string | null;
}

interface Query extends PromiseLike<{ data: unknown; error: unknown }> {
  in(column: string, values: readonly string[]): Query;
  not(column: string, operator: string, value: null): Query;
}
interface Client {
  from(table: string): { select(columns: string): Query };
}

/** PostgREST puts the `in` list in the URL; keep each request short. */
const CHUNK = 100;

export async function loadDeclarationFollowUps(
  client: unknown,
  declarationIds: readonly string[],
): Promise<Map<string, DeclarationFollowUpFields>> {
  const map = new Map<string, DeclarationFollowUpFields>();
  const ids = [...new Set(declarationIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    const answers = await Promise.all(
      chunks.map((chunk) =>
        (client as Client)
          .from('staff_declarations_v')
          .select('id, previous_status, previous_worker_message')
          .in('id', chunk)
          .not('replaces_declaration_id', 'is', null),
      ),
    );
    if (answers.some((answer) => answer.error)) return map;
    for (const answer of answers) {
      for (const row of (answer.data as Record<string, unknown>[] | null) ?? []) {
        if (typeof row['id'] !== 'string') continue;
        map.set(row['id'], {
          declaration_previous_status:
            typeof row['previous_status'] === 'string' ? row['previous_status'] : null,
          declaration_previous_message:
            typeof row['previous_worker_message'] === 'string'
              ? row['previous_worker_message']
              : null,
        });
      }
    }
  } catch {
    return map;
  }
  return map;
}
