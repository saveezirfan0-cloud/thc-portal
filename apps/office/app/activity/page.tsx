import { loadActivity } from './data';
import { ActivityScreen } from './ActivityScreen';
import { parseFilters } from './view-model';

export const metadata = { title: 'Activity log · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /activity — the audit trail (§1.7), readable: who did what, to whom,
 * when (ADR-0055). Filters live in the URL so a filtered view can be
 * shared or bookmarked; "Older" pages on the log's id, and "Export CSV"
 * carries the same filters to /activity/export.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFilters((key) => params[key]);
  return <ActivityScreen data={await loadActivity(filters)} filters={filters} />;
}
