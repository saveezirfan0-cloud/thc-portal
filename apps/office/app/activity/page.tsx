import { loadActivity } from './data';
import { ActivityScreen } from './ActivityScreen';
import { parsePeriod } from './view-model';

export const metadata = { title: 'Activity log · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /activity — the audit trail (§1.7), readable: who did what, to whom,
 * when (ADR-0035). Filters live in the URL so a filtered view can be
 * shared or bookmarked; "Older" pages on the log's id.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const before = Number(params['before']);
  const filters = {
    entity: params['entity'] || null,
    actor: params['actor'] || null,
    query: params['q']?.trim() || null,
    period: parsePeriod(params['period']),
    before: Number.isSafeInteger(before) && before > 0 ? before : null,
  };
  return <ActivityScreen data={await loadActivity(filters)} filters={filters} />;
}
