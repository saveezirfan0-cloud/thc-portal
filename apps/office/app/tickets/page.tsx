import { AutoRefresh } from '../_components/AutoRefresh';
import { currentTimeFormat } from '../_lib/timeFormat';
import { loadTickets } from './data';
import { TicketsScreen } from './TicketsScreen';
import { parseQuery } from './view-model';

export const metadata = { title: 'Tickets · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /tickets — what the team reported from the Report button (ADR-0199).
 * Filters live in the address, as on /inbox and /activity.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseQuery(await searchParams);
  const [data, format] = await Promise.all([loadTickets(query), currentTimeFormat()]);
  return (
    <>
      <AutoRefresh />
      <TicketsScreen data={data} query={query} format={format} />
    </>
  );
}
