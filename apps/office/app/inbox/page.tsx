import { loadInbox } from './data';
import { InboxScreen } from './InboxScreen';
import { parsePeriod, parseStatus } from './filters';
import { parseType } from './view-model';

export const metadata = { title: 'Inbox · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /inbox — the emails the platform sent to the office and to payroll
 * (ADR-0038): what, about whom, when, and whether it went. Read-only.
 * Filters live in the URL, as on /activity; "Older" pages on the outbox id.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const before = Number(params['before']);
  const filters = {
    type: parseType(params['type']),
    status: parseStatus(params['status']),
    period: parsePeriod(params['period']),
    before: Number.isSafeInteger(before) && before > 0 ? before : null,
  };
  return <InboxScreen data={await loadInbox(filters)} filters={filters} />;
}
