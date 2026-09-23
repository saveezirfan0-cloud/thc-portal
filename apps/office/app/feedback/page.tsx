import { OfficeShell } from '../_components/OfficeShell';
import { loadFeedback } from './data';
import { FeedbackScreen } from './FeedbackScreen';
import { parseQuery } from './view-model';
import './feedback.css';

// The inbox and its unread count are per-request. Never prerender.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Feedback · THC Back Office' };

/**
 * /feedback — §9.10, `wireframes/backoffice/feedback.html`.
 *
 * Read on the server from `feedback_entries_v`, which returns rows to an
 * admin only (ADR-0016). The screen's writes go through the RPCs in
 * 20260923140000_feedback_inbox.sql, where §9.10's rules — client entries
 * read-only, Mark as read the moment an entry starts counting — are held.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseQuery(await searchParams);
  const data = await loadFeedback(query);

  return (
    <OfficeShell
      activeHref="/feedback"
      title="Feedback"
      crumbs={
        <>
          every piece of feedback about workers, in one place · <b>{data.unread} unread</b> from
          clients
        </>
      }
    >
      <FeedbackScreen data={data} query={query} />
    </OfficeShell>
  );
}
