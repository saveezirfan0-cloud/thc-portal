import { AutoRefresh } from '../_components/AutoRefresh';
import { currentTimeFormat } from '../_lib/timeFormat';
import { loadInbox } from './data';
import { InboxScreen } from './InboxScreen';
import { parseAudience, parsePeriod, parseSearch, parseStatus } from './filters';
import { parseType } from './view-model';

export const metadata = { title: 'Inbox · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /inbox — the emails the platform sent: to the office and payroll
 * (ADR-0058), and to candidates, workers and clients (ADR-0086): what,
 * about whom, when, and whether it went. Read-only.
 * Filters live in the URL, as on /activity; "Older" pages on the outbox id.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const before = Number(params['before']);
  const audience = parseAudience(params['who']);
  const filters = {
    audience,
    q: parseSearch(params['q']),
    type: parseType(params['type'], audience),
    status: parseStatus(params['status']),
    period: parsePeriod(params['period']),
    before: Number.isSafeInteger(before) && before > 0 ? before : null,
  };
  return (
    <>
      <AutoRefresh />
      <InboxScreen
        data={await loadInbox(filters)}
        filters={filters}
        format={await currentTimeFormat()}
      />
    </>
  );
}
